from flask import Flask, request, jsonify
import json
from llamaapi import LlamaAPI
import re
from flask_cors import CORS, cross_origin


# Initialize the Llama API (replace with your credentials)
llama = LlamaAPI("LL-bebnOS9BVmZX910GrPwbsxPGUlUecZEiPDDKpImyRPwZlQk3TGDO2VdfHoD5hKNB")

app = Flask(__name__)

# init cors
# CORS(app)
CORS(app, resources={r"/process_text": {"origins": "http://127.0.0.1:5173"}})

@app.route("/process_text", methods=["POST"])
@cross_origin()
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
  except UnicodeDecodeError:
      return jsonify({"error": "Error decoding file content"}), 500

  # Process the text line by line
  data_list = []
  json_pattern = re.compile(r'\{[\s\S]*\}')
  count = 0
  for line in sample_text.split("\n"):
      try:
          # Build the API request
          content = f"""Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound) and Price from the text below and return the value as a json object like 'model':'value', 'storage':'value', 'lock_status':'value', 'sim_type':'value', 'device_type':'value': 'price':'value'
          {line}
          """

          sample_request = {
              "messages": [
                  {"role": "user", "content": content},
              ]
          }

          response = llama.run(sample_request)
          output = response.json()['choices'][0]['message']["content"]

          # Search for JSON object in the text
          match = json_pattern.search(output)

          if match:
              json_str = match.group()
              print("Output", json_str)
              data = json.loads(json_str)
              data_list.append(data)
          else:
              print(f"No JSON object found for line: {line}")

          count += 1
          if count == 100:
              break
      except:
          print(f"Error processing line: {line}")

  # Return the extracted data as JSON
  return jsonify({"data": data_list})

if __name__ == "__main__":
  app.run(debug=True)