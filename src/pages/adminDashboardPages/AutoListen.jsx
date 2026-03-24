import React, { useState, useEffect, useRef } from 'react';

const AutoListen = () => {
  const [logs, setLogs] = useState('Connecting to server logs...\n');
  const [keywordText, setKeywordText] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const terminalRef = useRef(null);

  const loadAutoListenSettings = async () => {
    setLoadingSettings(true);
    try {
      const response = await fetch('/api/admin/settings/autolisten_config', {
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load AutoListen settings');
      setKeywordText(String(payload.data?.keywords || ''));
    } catch (error) {
      console.error('Failed to load AutoListen settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  };

  const saveAutoListenSettings = async () => {
    setSavingSettings(true);
    try {
      const response = await fetch('/api/admin/settings/autolisten_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({
          keywords: keywordText,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to save AutoListen settings');
      alert('✅ AutoListen settings saved to Firebase.');
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

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
    loadAutoListenSettings();
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
      <div className="mb-4 p-4 rounded-[10px] border border-gray-200 bg-white">
        <label className="block text-sm font-bold text-[#1A1C23] mb-2">AutoListen Keywords / Filters (Global)</label>
        <textarea
          value={keywordText}
          onChange={(event) => setKeywordText(event.target.value)}
          className="w-full min-h-[110px] border rounded-lg p-3 text-sm"
          placeholder="Enter keywords or filters..."
          disabled={loadingSettings || savingSettings}
        />
        <div className="mt-3">
          <button
            onClick={saveAutoListenSettings}
            disabled={loadingSettings || savingSettings}
            className="bg-[#1A1C23] text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {savingSettings ? 'Saving...' : 'Save AutoListen Settings'}
          </button>
        </div>
      </div>
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
