import { useEffect, useMemo, useState } from 'react';
import { BsFillCpuFill } from 'react-icons/bs';
import { MutatingDots } from 'react-loader-spinner';
//import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { toast } from 'react-toastify';
//import { db } from '../../services/firebase';
const _localBE = 'http://localhost:8000/process';
const cloudBE = 'https://backend.horleytech.com/process';

const Ai = () => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  // const [pricesData, setPricesData] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  const [savingGlobalSettings, setSavingGlobalSettings] = useState(false);
  const [loadingGlobalSettings, setLoadingGlobalSettings] = useState(false);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [mappingsByCategory, setMappingsByCategory] = useState({});
  const [mappingCategory, setMappingCategory] = useState('Smartphones');
  const [mappingSearch, setMappingSearch] = useState('');
  const [selectedMappingKey, setSelectedMappingKey] = useState('');
  const [mappingForm, setMappingForm] = useState({
    raw: '',
    category: 'Smartphones',
    brand: 'Others',
    series: 'Others',
    deviceType: 'Unknown Device',
    condition: 'Unknown',
    specification: 'Unknown',
    source: 'manual',
    isOthers: false,
  });

  const mappingCategories = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];

  const _dummyData = [
    {
      model: 'Iphone X',
      storage: '64gb',
      lock_status: 'NFI',
      sim_type: 'Factory Unlocked',
      device_type: 'iphone',
      price: '120k',
    },
  ];

  const messages = [
    'AI Analyzing... Please wait 🤓',
    'AI is working... 🤖',
    'AI Studying Data 🧐...',
    'AI working hard 🕵️...',
    'This may take some time...',
  ];

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
      }, 2000); // Change message every 2 seconds
    }
    return () => clearInterval(interval);
  }, [loading, messages.length]);

  useEffect(() => {
    console.log({ file });
  }, [file]);

  const loadGlobalSettingsFromFirebase = async () => {
    setLoadingGlobalSettings(true);
    try {
      const response = await fetch('/api/admin/settings/ai_config', {
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load AI settings');
      setCustomPromptText(String(payload.data?.stageOnePrompt || ''));
    } catch (error) {
      console.error('Failed to load AI settings:', error);
    } finally {
      setLoadingGlobalSettings(false);
    }
  };

  const saveGlobalSettingsToFirebase = async () => {
    setSavingGlobalSettings(true);
    try {
      const response = await fetch('/api/admin/settings/ai_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({
          stageOnePrompt: customPromptText,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to save AI settings');
      toast.success('AI global settings saved to Firebase');
    } catch (error) {
      toast.error(error.message || 'Failed to save AI settings');
    } finally {
      setSavingGlobalSettings(false);
    }
  };

  useEffect(() => {
    loadGlobalSettingsFromFirebase();
  }, []);

  const loadMappingsFromFirebase = async () => {
    setLoadingMappings(true);
    try {
      const response = await fetch('/api/admin/mappings', {
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load mappings');
      setMappingsByCategory(payload.data || {});
    } catch (error) {
      toast.error(error.message || 'Failed to load mapping dictionary');
    } finally {
      setLoadingMappings(false);
    }
  };

  useEffect(() => {
    loadMappingsFromFirebase();
  }, []);

  const mappingItems = useMemo(() => {
    const source = Array.isArray(mappingsByCategory?.[mappingCategory]?.items)
      ? mappingsByCategory[mappingCategory].items
      : [];
    if (!mappingSearch.trim()) return source;
    const needle = mappingSearch.trim().toLowerCase();
    return source.filter((item) => [item.raw, item.deviceType, item.brand, item.series]
      .map((value) => String(value || '').toLowerCase())
      .some((text) => text.includes(needle)));
  }, [mappingsByCategory, mappingCategory, mappingSearch]);

  const handleMappingSelect = (item) => {
    setSelectedMappingKey(item.key);
    setMappingForm({
      raw: item.raw || '',
      category: item.category || mappingCategory,
      brand: item.brand || 'Others',
      series: item.series || 'Others',
      deviceType: item.deviceType || 'Unknown Device',
      condition: item.condition || 'Unknown',
      specification: item.specification || 'Unknown',
      source: item.source || 'manual',
      isOthers: Boolean(item.isOthers),
    });
  };

  const resetMappingForm = () => {
    setSelectedMappingKey('');
    setMappingForm({
      raw: '',
      category: mappingCategory,
      brand: 'Others',
      series: 'Others',
      deviceType: 'Unknown Device',
      condition: 'Unknown',
      specification: 'Unknown',
      source: 'manual',
      isOthers: false,
    });
  };

  const saveMapping = async () => {
    if (!String(mappingForm.raw || '').trim()) {
      toast.error('Raw mapping text is required');
      return;
    }
    setSavingMapping(true);
    try {
      const response = await fetch('/api/admin/mappings/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify(mappingForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to save mapping');
      toast.success('Dictionary mapping saved to Firebase');
      await loadMappingsFromFirebase();
      setMappingCategory(payload.category || mappingForm.category || mappingCategory);
      setSelectedMappingKey(payload.key || selectedMappingKey);
    } catch (error) {
      toast.error(error.message || 'Failed to save mapping');
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'text/plain') {
      setFile(droppedFile);
    } else {
      alert('Please upload a .txt file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile && selectedFile.type === 'text/plain') {
      setFile(selectedFile);
    } else {
      alert('Please upload a .txt file');
    }
  };

  // const handleAiResponse = (data) => {};

  const handleSubmit = async (event) => {
    event.preventDefault();
    console.log("handleSubmit triggered"); // DEBUG: Check if function is called
    if (!file) {
      toast.error('Please Attach txt file 😢');
      return;
    }
    setLoading(true);

    // handle upload request
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);

    fetch(cloudBE, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(async (data) => {
        console.log('Success:', data);
        if (data.status === false) {
          setFile(null);
          setTitle('');
          setResponseMessage(
            data.message || 'Error uploading file. Try Again.'
          );
          setSuccess(false);
          setLoading(false);
          toast(data.message || 'Error');
          return;
        }
        // handleAiResponse(data);
        // if (data.length > 0) {
        //   console.log(typeof data);

        //   const firebaseGroupResponse = await addGroup();
        //   console.log({ firebaseGroupResponse });

        //   await addPrices(data);
        // }
        setResponseMessage(data.message);
        setLoading(false);
        setSuccess(true);
        setFile(null);
        setTitle('');
        toast(data.message);
      })
      .catch((error) => {
        console.error('Error:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <div className="px-10">
      <div className="">
        <div className="flex items-center space-x-5">
          <BsFillCpuFill className="h-6 w-6" />
          <h3 className="font-extrabold text-xl">AI TXT Analyzer</h3>
        </div>

        <div className="my-5">
          <div className="mb-8 p-4 rounded-lg border border-gray-200 bg-white w-[50%]">
            <label htmlFor="ai-prompt" className="block font-bold text-base mb-2">
              AI Stage 1 Prompt (Global)
            </label>
            <textarea
              id="ai-prompt"
              value={customPromptText}
              onChange={(event) => setCustomPromptText(event.target.value)}
              className="w-full min-h-[120px] border rounded-lg p-3"
              placeholder="Write the global AI extraction prompt..."
              disabled={loadingGlobalSettings || savingGlobalSettings}
            />
            <button
              type="button"
              onClick={saveGlobalSettingsToFirebase}
              disabled={loadingGlobalSettings || savingGlobalSettings}
              className="mt-3 bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-700 disabled:opacity-50"
            >
              {savingGlobalSettings ? 'Saving...' : 'Save AI Global Settings'}
            </button>
          </div>

          <div className="mb-8 p-4 rounded-lg border border-gray-200 bg-white w-full">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-lg">Product Mapping Dictionary (Firebase)</h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadMappingsFromFirebase}
                  disabled={loadingMappings}
                  className="bg-slate-800 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
                >
                  {loadingMappings ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  type="button"
                  onClick={resetMappingForm}
                  className="bg-gray-100 text-gray-800 px-3 py-1.5 rounded text-sm"
                >
                  New Mapping
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              This menu shows current auto/manual mappings from Firebase. Edit any mapping and save it to improve how AI categorizes products.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1 border rounded-lg p-3 bg-gray-50">
                <div className="mb-3">
                  <label className="text-xs font-bold uppercase text-gray-500">Category Bucket</label>
                  <select
                    value={mappingCategory}
                    onChange={(event) => {
                      setMappingCategory(event.target.value);
                      setSelectedMappingKey('');
                    }}
                    className="w-full mt-1 border rounded p-2"
                  >
                    {mappingCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={mappingSearch}
                  onChange={(event) => setMappingSearch(event.target.value)}
                  className="w-full border rounded p-2 mb-3"
                  placeholder="Search by raw text or device..."
                />
                <div className="max-h-[360px] overflow-y-auto space-y-2">
                  {mappingItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleMappingSelect(item)}
                      className={`w-full text-left p-2 border rounded ${selectedMappingKey === item.key ? 'border-black bg-white' : 'border-gray-200 bg-white/80'}`}
                    >
                      <p className="font-semibold text-sm truncate">{item.raw}</p>
                      <p className="text-xs text-gray-500">{item.deviceType} • {item.condition}</p>
                    </button>
                  ))}
                  {!mappingItems.length && (
                    <p className="text-sm text-gray-500">No mappings found in this bucket.</p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 border rounded-lg p-4">
                <h5 className="font-bold mb-3">{selectedMappingKey ? 'Edit Mapping' : 'Add Mapping Manually'}</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="border rounded p-2 md:col-span-2" placeholder="Raw source text from CSV or WhatsApp" value={mappingForm.raw} onChange={(event) => setMappingForm((prev) => ({ ...prev, raw: event.target.value }))} />
                  <select className="border rounded p-2" value={mappingForm.category} onChange={(event) => setMappingForm((prev) => ({ ...prev, category: event.target.value }))}>
                    {mappingCategories.map((category) => <option key={`form-${category}`} value={category}>{category}</option>)}
                  </select>
                  <input className="border rounded p-2" placeholder="Brand" value={mappingForm.brand} onChange={(event) => setMappingForm((prev) => ({ ...prev, brand: event.target.value }))} />
                  <input className="border rounded p-2" placeholder="Series" value={mappingForm.series} onChange={(event) => setMappingForm((prev) => ({ ...prev, series: event.target.value }))} />
                  <input className="border rounded p-2" placeholder="Device Type" value={mappingForm.deviceType} onChange={(event) => setMappingForm((prev) => ({ ...prev, deviceType: event.target.value }))} />
                  <input className="border rounded p-2" placeholder="Condition" value={mappingForm.condition} onChange={(event) => setMappingForm((prev) => ({ ...prev, condition: event.target.value }))} />
                  <input className="border rounded p-2" placeholder="Specification / SIM / Processor" value={mappingForm.specification} onChange={(event) => setMappingForm((prev) => ({ ...prev, specification: event.target.value }))} />
                  <input className="border rounded p-2" placeholder="Source (manual/auto)" value={mappingForm.source} onChange={(event) => setMappingForm((prev) => ({ ...prev, source: event.target.value }))} />
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={Boolean(mappingForm.isOthers)} onChange={(event) => setMappingForm((prev) => ({ ...prev, isOthers: event.target.checked }))} />
                    Mark as Others
                  </label>
                </div>
                <button
                  type="button"
                  onClick={saveMapping}
                  disabled={savingMapping}
                  className="mt-4 bg-black text-white px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {savingMapping ? 'Saving...' : 'Save Mapping to Firebase'}
                </button>
              </div>
            </div>
          </div>

          <form
            className="flex flex-col space-y-5 w-[50%]"
            onSubmit={handleSubmit}
          >
            <div className="space-x-10">
              <label htmlFor="title" className="font-bold text-lg">
                Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                id="title"
                name="title"
                className="p-3 rounded-lg border"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                required
              />
            </div>

            <div className="w-full">
              <div className="w-full h-[20rem] bg-[#F8F8F8] p-3">
                <div
                  className="flex items-center justify-center w-full h-full border border-dashed border-black"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  {file ? (
                    <div className="flex flex-col items-center space-y-3">
                      <p className="text-sm text-center">{file.name}</p>
                      <button
                        className="bg-black text-white rounded-sm w-16 hover:bg-gray-700 hover:opacity-75"
                        onClick={(e) => {
                          e.preventDefault();
                          setTitle('');
                          setFile(null);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <>
                      <label
                        htmlFor="file"
                        className="cursor-pointer font-bold text-lg"
                      >
                        Upload or drag a file here
                      </label>
                      <input
                        type="file"
                        accept=".txt"
                        id="file"
                        name="file"
                        className="hidden"
                        onChange={handleChange}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {responseMessage && (
              <p
                className={`text-center ${
                  success ? 'text-green-600' : 'text-red-600'
                } font-bold`}
              >
                {responseMessage}
              </p>
            )}
            <div className="flex items-center justify-center">
              {loading ? (
                <>
                  <MutatingDots
                    visible={true}
                    height="100"
                    width="100"
                    color="#000"
                    secondaryColor="#000"
                    radius="10.5"
                    ariaLabel="mutating-dots-loading"
                    wrapperStyle={{}}
                    wrapperClass=""
                  />
                  <p className="font-bold">
                    {' '}
                    Horley
                    <span className="text-orange-400">Tech</span>{' '}
                    {messages[messageIndex]}
                  </p>
                </>
              ) : (
                <button
                  type="submit"
                  className="bg-black text-white rounded-lg w-32 py-2 hover:bg-gray-700 hover:opacity-75"
                >
                  Upload
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Ai;
