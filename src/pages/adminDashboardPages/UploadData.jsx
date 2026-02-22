import React, { useState } from 'react';

const UploadData = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleUpload = async () => {
    if (!file) {
      setMessage('Please select a .txt file first.');
      return;
    }
    setLoading(true);
    setMessage('');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      // The Vercel bridge safely routes this to your backend!
      const response = await fetch('/process', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      if (data.status) {
        setMessage('✅ AI Processing Started! Check the dashboard shortly.');
      } else {
        setMessage('❌ Upload failed.');
      }
    } catch (err) {
      console.error(err);
      setMessage('❌ Failed to fetch. Ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-[10px] shadow-sm mt-10 border border-gray-100">
      <h2 className="text-2xl font-bold mb-4 text-[#1A1C23]">TXT WhatsApp Analyzer</h2>
      <p className="text-gray-600 mb-6">Upload an exported WhatsApp chat (.txt) to automatically extract products and update the offline inventory.</p>
      
      <div className="border-2 border-dashed border-gray-300 rounded-[10px] p-10 text-center bg-gray-50">
        <input 
          type="file" 
          accept=".txt" 
          onChange={(e) => setFile(e.target.files[0])} 
          className="mb-6 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer mx-auto"
        />
        <button 
          onClick={handleUpload}
          disabled={loading}
          className="bg-[#1A1C23] text-white px-8 py-3 rounded-[10px] font-bold hover:bg-gray-800 disabled:bg-gray-400 transition-colors"
        >
          {loading ? 'AI Processing File...' : 'Upload & Analyze'}
        </button>
      </div>
      {message && <p className={`mt-6 font-bold text-center ${message.includes('❌') ? 'text-red-500' : 'text-green-600'}`}>{message}</p>}
    </div>
  );
};

export default UploadData;
