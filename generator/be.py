import os
import json
import re
from flask import Flask, request, jsonify
from openai import OpenAI
from dotenv import load_dotenv
from flask_cors import CORS, cross_origin

# Load the .env file
load_dotenv()

# Fetch openai api key from environment 
api_key = os.getenv("OPENAI_API_KEY")

set_max_token = 17500

# Initialize OpenAI client
client = OpenAI(api_key=api_key)

app = Flask(__name__)

# CORS(app, resources={r"/process_text": {"origins": "0.0.0.0:5173"}})
# CORS(app, resources={r"/process_text": {"origins": "*"}})
CORS(app)

@app.route("/process_text", methods=["POST"])
# @cross_origin()
def process_text():
    """
    API endpoint to process uploaded text file
    """
    # Check if a file is uploaded
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    # Get the uploaded file
    uploaded_file = request.files["file"]
    if uploaded_file.filename.lower().endswith(".txt") is False:
        return jsonify({"error": "Invalid file format. Only .txt files allowed"}), 400

    # Read the file content
    try:
        sample_text = uploaded_file.read().decode("utf-8")
        if len(sample_text) > set_max_token:
            return jsonify({"error": "Maximum token exceeded"}), 500
        else:
           pass
    except UnicodeDecodeError:
        return jsonify({"error": "Error decoding file content"}), 500
    
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
    return jsonify(model_response)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
