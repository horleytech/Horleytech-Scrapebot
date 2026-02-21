import React, { useState } from 'react';
import { FaCloudUploadAlt } from 'react-icons/fa';

const UploadData = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus({ type: '', message: '' }); // Clear any previous messages
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setStatus({ type: 'error', message: 'Please select a .txt file first.' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Point this to your backend server IP/Port (adjust if your port is different)
      const response = await fetch('http://localhost:8000/process', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setStatus({ type: 'success', message: result.message || 'File uploaded successfully! AI is processing in the background.' });
        setFile(null); // Reset the input
        document.getElementById('file-upload').value = ""; // Clear file input UI
      } else {
        setStatus({ type: 'error', message: result.message || 'Upload failed. Please try again.' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setStatus({ type: 'error', message: 'Network error. Could not connect to the server.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-[#1A1C23]">Manual Data Upload</h1>
        <p className="text-gray-500 mt-1">Upload a WhatsApp chat export (.txt) to extract inventory via AI.</p>
      </div>

      <div className="bg-white p-8 rounded-[10px] shadow-sm border border-gray-100">
        <form onSubmit={handleUpload} className="flex flex-col items-center">
          
          <div className="w-full border-2 border-dashed border-gray-300 rounded-[10px] p-10 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors">
            <FaCloudUploadAlt className="w-16 h-16 text-gray-400 mb-4" />
            <label className="cursor-pointer bg-[#1A1C23] text-white px-6 py-2 rounded-md font-medium hover:bg-gray-800 transition-colors">
              Browse Files
              <input 
                id="file-upload"
                type="file" 
                accept=".txt" 
                className="hidden" 
                onChange={handleFileChange} 
              />
            </label>
            <p className="text-sm text-gray-500 mt-3">
              {file ? (
                <span className="font-semibold text-green-600">Selected: {file.name}</span>
              ) : (
                "Select a valid WhatsApp .txt export file"
              )}
            </p>
          </div>

          <button 
            type="submit" 
            disabled={loading || !file}
            className={`mt-6 w-full py-3 rounded-[10px] font-bold text-white transition-all ${
              loading || !file ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 shadow-md'
            }`}
          >
            {loading ? 'Uploading & Processing...' : 'Upload & Start AI Extraction'}
          </button>

          {/* Status Messages */}
          {status.message && (
            <div className={`mt-6 w-full p-4 rounded-md text-center font-medium ${
              status.type === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
            }`}>
              {status.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default UploadData;
