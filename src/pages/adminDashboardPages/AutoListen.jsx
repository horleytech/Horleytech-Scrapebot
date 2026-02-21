import React, { useState } from 'react';
import { FaRobot, FaCheckCircle, FaCopy } from 'react-icons/fa';

const AutoListen = () => {
  const [copied, setCopied] = useState(false);
  
  // NOTE: Replace the IP address below with your actual live server IP or domain once deployed!
  const serverIP = "YOUR_SERVER_IP"; 
  const secretKey = "my_super_secure_password_123"; // Make sure this matches your .env
  
  const webhookUrl = `http://${serverIP}:8000/api/webhook/whatsapp?secret=${secretKey}`;

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
        
        {/* Status Banner */}
        <div className="bg-green-50 border-b border-green-100 p-6 flex items-center gap-4">
          <FaCheckCircle className="w-8 h-8 text-green-500" />
          <div>
            <h2 className="text-lg font-bold text-green-800">System is Online & Listening</h2>
            <p className="text-sm text-green-700">
              The backend webhook is ready to receive messages from your Android AutoResponder app.
            </p>
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="p-8">
          <h3 className="text-xl font-bold text-[#1A1C23] mb-4">Android App Setup Instructions</h3>
          <p className="text-gray-600 mb-6 leading-relaxed">
            To automatically send vendor messages to this platform, open your Android AutoResponder app and set up a new rule with the following Webhook configuration:
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6 relative">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Webhook URL</h4>
            <div className="flex justify-between items-center">
              <code className="text-blue-600 text-sm font-mono break-all pr-4">
                {webhookUrl}
              </code>
              <button 
                onClick={handleCopy}
                className="flex items-center gap-2 bg-white border border-gray-300 px-3 py-1.5 rounded shadow-sm text-sm hover:bg-gray-100 transition-colors"
              >
                <FaCopy className="text-gray-500" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-bold text-[#1A1C23] mb-2">1. App Trigger Settings</h4>
              <ul className="text-sm text-gray-600 space-y-2 list-disc pl-4">
                <li>Set the rule to trigger on <strong>All Messages (*)</strong> or specific groups.</li>
                <li>Ensure the app has permission to read notifications.</li>
              </ul>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-bold text-[#1A1C23] mb-2">2. JSON Payload Behavior</h4>
              <ul className="text-sm text-gray-600 space-y-2 list-disc pl-4">
                <li>You do not need to configure custom headers.</li>
                <li>The server automatically extracts the <code>sender</code> and <code>message</code> from the app's default payload.</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AutoListen;
