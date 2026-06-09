import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises"; 
import path from "path";
import { analyzeImageByAI } from "./ImagetoJsonAi.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        return cb(null, "./uploads");
    },
    filename: (req, file, cb) => {
        return cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
      const allowed = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "application/pdf"
      ];
  
      cb(null, allowed.includes(file.mimetype));
    }
  });
app.post("/upload-multiple", upload.array("images"), async (req, res) => {
    console.log("Files received via Multer");
    const files = req.files;
    
    if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
    }

    try {
       
        const isSuccess = await analyzeImageByAI();
        
        if (isSuccess) {
            const csvPath = path.join(process.cwd(), "output.csv");

           
            return res.download(csvPath, "menu_extraction.csv", async (err) => {
                if (err) {
                    console.error("Error sending the CSV file:", err);
                   
                    if (!res.headersSent) {
                        res.status(500).json({ message: "Error downloading CSV" });
                    }
                }

          
                try {
                    await fs.unlink(csvPath);
                    console.log("Successfully deleted output.csv after transfer");
                } catch (unlinkErr) {
                    console.error("Failed to delete output.csv:", unlinkErr);
                }
            });
        } else {
            return res.status(500).json({ message: "AI extraction failed to generate data." });
        }

    } catch (error) {
        console.error("Route Handler Error:", error);
        return res.status(500).json({ message: "Internal server error during processing." });
    }
});

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});