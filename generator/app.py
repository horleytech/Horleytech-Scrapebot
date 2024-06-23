import os
import json
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from dotenv import load_dotenv

# Load the .env file
load_dotenv()

# Fetch openai api key from environment
api_key = os.getenv("OPENAI_API_KEY")

set_max_token = 17500

# Initialize OpenAI client
client = OpenAI(api_key=api_key)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

@app.get("/")
async def index():
    return JSONResponse({
        "success": True
    })

@app.post("/process_text")
async def process_text(file: UploadFile = File(...)):
    """
    API endpoint to process uploaded text file
    """
    # Check if a file is uploaded
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")

    # Check file format
    if not file.filename.lower().endswith(".txt"):
        raise HTTPException(status_code=400, detail="Invalid file format. Only .txt files allowed")

    # Read the file content
    try:
        sample_text = (await file.read()).decode("utf-8")
        if len(sample_text) > set_max_token:
            raise HTTPException(status_code=500, detail="Maximum token exceeded")
    except UnicodeDecodeError:
        raise HTTPException(status_code=500, detail="Error decoding file content")

    content = f"""Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound) and Price from the text below and return the value as a list of json object with each object like 'model':'value', 'storage':'value', 'lock_status':'value', 'sim_type':'value', 'device_type':'value': 'price':'value'. If a line contains more than one price specification, extract each price as different json object.
                {sample_text}
                """

    # Function to send prompt and receive response
    def send_message(prompt):
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "user", "content": prompt}
            ],
            stop=None,
            temperature=0.7
        )
        return response.choices[0].message.content

    model_response = send_message(content)

    # Return the model response
    return JSONResponse(content=json.loads(model_response))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug")
