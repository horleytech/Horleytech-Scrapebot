import React, { useState } from 'react';
import { BASE_URL } from '../../services/constants/apiConstants.js';

const UploadData = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  // Initialized the status state which was missing in the conflict snippet
  const [status, setStatus] = useState({ type: '', message: '' });

  const handleUpload = async (event) => {
    event.preventDefault();

    if (!file) {
      setStatus({ type: 'error', message: 'Please select a WhatsApp .txt export before uploading.' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      // THE FIX: Uses the Vercel Proxy source path to bypass security blocks
      const response = await fetch(`${BASE_URL}/process`, {
        method: 'POST',
        body: formData,
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || !payload.status) {
        throw new Error(payload.message || 'Upload failed. Please try again.');
      }

      setStatus({
        type: 'success',
        message: '✅ File uploaded and AI processing started successfully! Check the directory shortly.',
      });
      setFile(null);
      
      // Resets the file input field visually
      const input = document.getElementById('txt-upload-input');
      if (input) input.value = '';
      
    } catch (error) {
      console.error(error);
      const networkError = error?.message === 'Failed to fetch'
        ? '❌ Failed to fetch. Ensure backend is running and the Vercel proxy is active.'
        : error.message || 'Something went wrong during upload.';

      setStatus({ type: 'error', message: networkError });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-8">
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-[#1A1C23]">TXT Analyzer</h1>
        <p className="text-gray-500 mt-1">Upload WhatsApp chat exports (.txt) directly for AI parsing.</p>
      </div>

      <div className="bg-white p-8 rounded-[10px] shadow-sm border border-gray-100">
        <form onSubmit={handleUpload} className="space-y-5">
          <div className="border border-gray-200 rounded-[10px] p-5 bg-gray-50">
            <label htmlFor="txt-upload-input" className="block text-sm font-semibold text-gray-700 mb-2">
              Select WhatsApp .txt file
            </label>
            <input
              id="txt-upload-input"
              type="file"
              accept=".txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full p-2 border border-gray-300 rounded-md bg-white cursor-pointer"
            />
            <p className="text-sm mt-2 text-gray-600">
              {file ? `Selected: ${file.name}` : 'No file selected yet.'}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !file}
            className={`w-full py-3 rounded-[10px] font-bold text-white flex justify-center items-center gap-2 transition-colors ${
              loading || !file ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#1A1C23] hover:bg-gray-800'
            }`}
          >
            {loading ? (
              <>
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                AI Processing File...
              </>
            ) : (
              <>☁️ Upload & Analyze</>
            )}
          </button>

          {status.message && (
            <div
              className={`p-4 rounded-md text-center font-medium ${
                status.type === 'error'
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-green-50 text-green-700 border border-green-200'
              }`}
            >
              {status.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default UploadData;