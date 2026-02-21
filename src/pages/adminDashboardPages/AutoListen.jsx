import React, { useState } from 'react';
import { FaRobot, FaCheckCircle, FaCopy } from 'react-icons/fa';

const AutoListen = () => {
  const [copied, setCopied] = useState(false);
  
  // Clean URL! No secret at the end anymore.
  const serverIP = "YOUR_SERVER_IP"; 
  const webhookUrl = `http://${serverIP}:8000/api/webhook/whatsapp`;

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <FaRobot className="w-8 h-8 text-[#1A1C23]" />
        <div>
          <h1 className="text-[24px] font-bold text-[#1A1C23]">Auto Listen Webhook</h1>
          <p className="text-gray-500 mt-1">Real-time WhatsApp extraction is currently active.</p>
        </div>
      </div>

      <div className="bg-white rounded-[10px] shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-green-50 border-b border-green-100 p-6 flex items-center gap-4">
          <FaCheckCircle className="w-8 h-8 text-green-500" />
          <div>
            <h2 className="text-lg font-bold text-green-800">System is Online & Listening</h2>
            <p className="text-sm text-green-700">
              The backend webhook is ready to receive secure messages from your Android app.
            </p>
          </div>
        </div>

        <div className="p-8">
          <h3 className="text-xl font-bold text-[#1A1C23] mb-4">Android App Setup Instructions</h3>
          
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Webhook URL</h4>
            <div className="flex justify-between items-center">
              <code className="text-blue-600 text-sm font-mono break-all pr-4">{webhookUrl}</code>
              <button onClick={handleCopy} className="flex items-center gap-2 bg-white border border-gray-300 px-3 py-1.5 rounded shadow-sm text-sm hover:bg-gray-100">
                <FaCopy className="text-gray-500" /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-bold text-[#1A1C23] mb-3">1. API Custom Header (Auth)</h4>
              <p className="text-sm text-gray-600 mb-2">In the AutoResponder app, locate the API Custom Header settings and add:</p>
              <ul className="text-sm font-mono bg-gray-200 p-3 rounded text-gray-800">
                <li><strong>Key:</strong> x-api-key</li>
                <li className="mt-1"><strong>Value:</strong> <span className="text-red-600">Your WEBHOOK_SECRET</span></li>
              </ul>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-bold text-[#1A1C23] mb-3">2. JSON Payload</h4>
              <p className="text-sm text-gray-600">
                Leave the JSON body settings alone. The app will send its default payload, and the server will automatically extract the sender and the message!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutoListen;
