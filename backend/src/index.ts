import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import apiRouter from './routes/api';
import authRouter from './routes/auth'; // Import new auth router

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json()); // Already present for body parsing

app.use('/api', apiRouter);
app.use('/api/auth', authRouter); // Mount auth router

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

