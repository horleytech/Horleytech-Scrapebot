import { useState, useEffect, useRef } from 'react';

const AutoListen = () => {
  const [logs, setLogs] = useState('Connecting to server logs...\n');
  const terminalRef = useRef(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch('/api/logs');
        if (response.ok) {
          const text = await response.text();
          setLogs(text);
        }
      } catch (err) {
        setLogs('Failed to fetch logs. Retrying...');
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold mb-2 text-[#1A1C23]">Live AI Server Logs</h2>
      <p className="text-gray-500 mb-6">Watch the backend extract data from incoming WhatsApp messages in real-time.</p>
      <div 
        ref={terminalRef}
        className="bg-black text-green-400 p-6 rounded-[10px] h-[600px] overflow-y-auto font-mono text-sm whitespace-pre-wrap shadow-inner"
      >
        {logs}
      </div>
    </div>
  );
};

export default AutoListen;
