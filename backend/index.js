import express from 'express';
import 'dotenv/config'
import cors from 'cors'
import multer from 'multer';
import {RecursiveCharacterTextSplitter} from '@langchain/textsplitters'
import getvectorStore from './db/db.js';
import { Document } from '@langchain/core/documents';
import { PDFParse } from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());
app.use(cors());
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT;
const ai = new GoogleGenAI({apiKey:process.env.GOOGLE_API_KEY});

async function startServer() {
    // await mongoClient.connect();
    app.listen(PORT, ()=>{
        // console.log('MONGODB is connected!!');
        console.log(`Server is running at PORT ${PORT}`);
    })
}

startServer();

// Upload and Ingestion

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        // Step A: Extract Text directly from the memory buffer
        const parser = new PDFParse({
            data: new Uint8Array(req.file.buffer)
        });
        const { pages } = await parser.getText();

        const docs = pages.map((page) => {
            return new Document({
                pageContent: page.text,
                metadata: { source: req.file.originalname, page: page.num - 1 },
            });
        });

        // Step B: Chunking Text
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        const splitDocs = await splitter.splitDocuments(docs);

        // Step C: Save to MongoDB
        const { vectorStore } = await getvectorStore();
        await vectorStore.addDocuments(splitDocs);

        res.status(200).json({ 
            success: true, 
            message: `Successfully processed ${splitDocs.length} chunks and saved.` 
        });

    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Internal server error during document processing.' });
    }
});

// Get Documents
app.get('/api/documents', async (req, res) => {
  try {
    const { vectorStore } = await getvectorStore();
    // Distinct filenames stored in MongoDB collection
    const filenames = await vectorStore.collection.distinct('source');
    res.status(200).json({ success: true, filenames });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Delete Documents
app.delete('/api/documents/:filename',async(req,res)=>{
    try{
        const {vectorStore} = await getvectorStore();
        const filename = decodeURIComponent(req.params.filename);

        const result = await vectorStore.collection.deleteMany({source : filename});

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Document not found in database.' });
        }
        res.status(200).json({ 
            success: true, 
            message: `Successfully deleted ${result.deletedCount} chunks for "${filename}".` 
        });
    }catch(error){
        console.log(error);
    }
});

// Question Answering

app.post('/api/ask',async(req,res)=>{
    const {question} = req.body;
    try{
        const {vectorStore} = await getvectorStore();
        const relevantDocs = await vectorStore.similaritySearch(question,3);
        const context = relevantDocs.map(d => d.pageContent).join('\n\n');

        const citations = [...new Set(relevantDocs.map(d => 
            d.metadata?.source || d.metadata?.filename || 'Notes_Document.pdf'
        ))];

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        res.write(`data: ${JSON.stringify({ type: 'metadata', citations })}\n\n`);

        const prompt = `You are an expert tutor. Answer the user's question accurately using ONLY the provided context below.

            Context:
            ${context}

            Question: ${question}`;

        const responseStream = await ai.models.generateContentStream({
            model:"gemini-3.8-flash",
            contents:prompt,
        });

        for await (const chunk of responseStream) {
            const textToken = chunk.text || '';
            if (textToken) {
                res.write(`data: ${JSON.stringify({ text: textToken })}\n\n`);
            }
        }
        res.write('data: [DONE]\n\n');
        res.end();
    }catch(error){
        console.log(error);
    }
});