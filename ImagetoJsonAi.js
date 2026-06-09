import fs from "fs/promises";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import dotenv from "dotenv";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Parser } from "json2csv";

dotenv.config();

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});


const menueItemScehma = z.object({
    "S.No": z.number().int(),
    "Name": z.string(),
    "Category": z.string().default("FOOD"),
    "Group": z.string(),
    "Price": z.number().int(),
    "product_kot_type": z.string().default("KOT"),
    "category_kot_type": z.string().default("KOT"),
});

const MenuExtractionResultSchema = z.array(menueItemScehma);
const geminiResponseScehma = zodToJsonSchema(MenuExtractionResultSchema);

export const getMimeType = (fileName) => {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".png") return "image/png";
    if (ext === ".pdf") return "application/pdf";

    return null;
};

export const analyzeImageByAI = async () => {
    const processedFilePaths = [];

    try {
        const uploadDir = path.join(process.cwd(), "uploads");
        const fileNames = await fs.readdir(uploadDir);

        if (fileNames.length === 0) {
            console.log("No files found");
            return false;
        }

        console.log(`Found ${fileNames.length} files`);

      
        const fileContents = (await Promise.all(
            fileNames.map(async (fileName) => {
                const filePath = path.join(uploadDir, fileName);
                processedFilePaths.push(filePath);

                const mimeType = getMimeType(fileName);

                if (!mimeType) {
                    console.log("Skipping unsupported file:", fileName);
                    return null;
                }

                const content = await fs.readFile(filePath);
                const base64 = content.toString("base64");

                console.log("Processing:", fileName, mimeType);

                return {
                    inlineData: {
                        data: base64,
                        mimeType
                    }
                };
            })
        )).filter(Boolean);

        if (!fileContents.length) {
            throw new Error("No valid image or PDF files found");
        }



        const systemInstruction = `
        # SYSTEM INSTRUCTIONS: MENU TO STRUCTURED DATA CONVERSION
        
        You are an expert data-extraction assistant. Your task is to extract menu items from provided images or scanned documents/PDFs and format them into a perfectly structured JSON array. This JSON will be directly exported to a CSV file, so you must strictly adhere to the column schema, filtering rules, and split item expansions described below.
        
        ---
        
        ## 1. TARGET JSON SCHEMA (CASE-SENSITIVE)
        Each item in the final JSON array must strictly contain these exact, PascalCase keys. Missing or improperly cased keys will break validation:
        - "S.No": Integer (Sequential number starting from 1).
        - "Name": String (The exact item name. For split items, append the specific variation).
        - "Category": String (Hardcoded to "FOOD" for all restaurant menu items).
        - "Group": String (The uppercase heading or section under which the item is listed, e.g., "SOUP", "MO:MO", "REFRESHERS").
        - "Price": Integer (The single numerical price for that specific row variant) if document contains price like tis Rs 250 just take number no need to take Rs string just pure number.
        - "product_kot_type": String . (use "KOT" for normal food and coffe teas but use  "BOT" if the menue items is bar beverages items.)
        - "category_kot_type": String (use "KOT" for normal food and coffe teas but use  "BOT" if the menue items is bar beverages items.)
        
        ---
        
        ## 2. CRITICAL RULES FOR FILTERING CONTENT (PDF & SCANS)
        Menu documents and PDFs often contain heavy descriptive elements, marketing copy, or background information. You must aggressively filter this noise out.
        
        - **WHAT TO EXTRACT**: 
          - Valid structured menu entries that explicitly link a product name to a clear price (Rs, ₹, or naked numbers).
          -Extract the price properly dont misread read exactly hat it is there make sure to read the price carefully so that there will be no any silly mistakes.
          - Explicit item name variations or listed serving metrics (ml, sizes, variations).
          - The clean Category or Group heading (take the group heading stuffs from the image like read sub heading of image for the group heading) .
        
        - **WHAT TO IGNORE**:
          - Long block descriptions, wellness paragraphs, or "Why your body loves it" styles of content.
          - Bulleted ingredient lists or micro-explanations listed underneath an item name.
          - Marketing pitches, historical blurbs, or general promotional taglines.
          - **GOLDEN RULE**: If a line or block of text does not explicitly resolve to a structured item with an associated price, completely ignore it.
        
        ---
        
        ## 3. CRITICAL RULES FOR RECONCILING VARIATIONS & SPLITS ("/")
        Menus often compress multiple items into one row using slash signs ("/") for variations, sizes, or multiple prices. You MUST flatten these rows into completely separate, standalone JSON objects.
        
        - **Split Prices / Split Variations**: If an item lists multiple variations and multiple prices separated by slashes, map the first variation to the first price, the second variation to the second price, and so on. 
        - **Split Sizes**: If an item lists different portion sizes (e.g., "250ML/500ML") along with split prices (e.g., "185/225"), create an individual item for each size variant.
        - **Matrix / Grid Menus**: If a menu lists items down the left column and different preparation styles across the top columns (e.g., Steam, Fried, Jhol) with distinct prices, extract every valid intersection as a unique item row.
        
        ---
        
        ## 4. FEW-SHOT EXAMPLES (FOR TRAINING/REFERENCE)
        
        ### Example A: Filtering Out Descriptions
        - **Menu Input Text**:
          "SOUP SECTION
          Hot & Sour Soup (Veg / Non-Veg)  200/290
          Our signature broth boiled to perfection. Great for gut health and fighting common colds. Contains soy sauce, mushrooms, and active proteins."
        - **Expected JSON Output**:
        [
          {
            "S.No": 1,
            "Name": "Hot & Sour Soup (Veg)",
            "Category": "FOOD",
            "Group": "SOUP SECTION",
            "Price": 200,
            "product_kot_type": "KOT",
            "category_kot_type": "KOT"
          },
          {
            "S.No": 2,
            "Name": "Hot & Sour Soup (Non-Veg)",
            "Category": "FOOD",
            "Group": "SOUP SECTION",
            "Price": 290,
            "product_kot_type": "KOT",
            "category_kot_type": "KOT"
          }
        ]
        
        ### Example B: Split Volume Sizes & Split Prices
        - **Menu Input Item**: Peach Lemonade (250/500ML)  RS.185/225
        - **Section Heading**: REFRESHERS
        - **Expected JSON Output**:
        [
          {
            "S.No": 3,
            "Name": "Peach Lemonade (250ML)",
            "Category": "FOOD",
            "Group": "REFRESHERS",
            "Price": 185,
            "product_kot_type": "KOT",
            "category_kot_type": "KOT"
          },
          {
            "S.No": 4,
            "Name": "Peach Lemonade (500ML)",
            "Category": "FOOD",
            "Group": "REFRESHERS",
            "Price": 225,
            "product_kot_type": "KOT",
            "category_kot_type": "KOT"
          }
        ]
        
        ---
        
        ## 5. EXECUTION
        Please review the attached menu files/images. Process them sequentially from top to bottom, row by row, map them using the filtering and data schema rules above, and output ONLY a valid JSON array code block. Ensure keys are exactly cased as requested (e.g., "S.No", "Name", "Group", "Price"). Do not wrap the JSON response in any conversational commentary or markdown prose.
        `;
        
        const userPrompt = `Please analyze the attached document or image files and extract the valid structured menu items according to your system instructions.`;

        console.log(`Sending ${fileContents.length} files to Gemini...`);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                ...fileContents,
                userPrompt
            ],
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                temperature: 0.1,
                responseJsonSchema: geminiResponseScehma
            }
        });

        const rawJsonText = response.text;
        const parsedData = JSON.parse(rawJsonText);

        const validated = MenuExtractionResultSchema.parse(parsedData);

        console.log("Items extracted:", validated.length);

        const parser = new Parser();
        const csv = parser.parse(validated);

        const outputPath = path.join(process.cwd(), "output.csv");
        await fs.writeFile(outputPath, csv);

        console.log("CSV generated");

        return true;

    } catch (err) {
        console.error("AI Processing Error:", err);
        return false;

    } finally {
     
        if (processedFilePaths.length > 0) {
            for (const filePath of processedFilePaths) {
                try {
                    await fs.unlink(filePath);
                    console.log("Deleted:", path.basename(filePath));
                } catch (e) {
                    console.error("Delete failed:", filePath);
                }
            }
        }
    }
};