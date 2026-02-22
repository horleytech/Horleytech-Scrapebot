import React, { useEffect, useRef, useState } from 'react';
import { FaRobot } from 'react-icons/fa';

const AutoListen = () => {
  const [logs, setLogs] = useState('Loading logs...');
  const [error, setError] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const fetchLogs = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/logs');
        const data = await response.json();
        if (!mounted) return;
        if (!response.ok) throw new Error(data?.message || 'Failed to load logs.');
        setLogs(data.logs || 'No logs yet.');
        setError('');
      } catch (err) {
        if (!mounted) return;
        setError(err.message);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <FaRobot className="w-8 h-8 text-[#1A1C23]" />
        <div>
          <h1 className="text-[24px] font-bold text-[#1A1C23]">Auto Listen PM2 Logs</h1>
          <p className="text-gray-500 mt-1">Live backend logs refresh every 3 seconds.</p>
        </div>
      </div>

      {error && <p className="mb-3 text-red-600 font-semibold">{error}</p>}

      <div
        ref={logRef}
        className="bg-black text-green-400 rounded-[10px] shadow-inner border border-gray-800 h-[520px] p-4 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap"
      >
        {logs}
      </div>
    </div>
  );
};

export default AutoListen;
