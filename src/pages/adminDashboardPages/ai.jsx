import { useEffect, useState } from 'react';
import { BsFillCpuFill } from 'react-icons/bs';
import { MutatingDots } from 'react-loader-spinner';
//import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { toast } from 'react-toastify';
//import { db } from '../../services/firebase';
const cloudBE = 'https://backend.horleytech.com/process';

const Ai = () => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  // const [pricesData, setPricesData] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [strictVendorsText, setStrictVendorsText] = useState('');
  const [strictRoutingEnabled, setStrictRoutingEnabled] = useState(true);
  const [loadingRouting, setLoadingRouting] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);

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

  const loadExtractionRouting = async () => {
    setLoadingRouting(true);
    try {
      const response = await fetch('/api/admin/settings/extractionRouting', {
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to load extraction routing settings');
      const strictVendors = Array.isArray(payload.data?.strictVendors)
        ? payload.data.strictVendors.join(', ')
        : String(payload.data?.strictVendors || '');
      setStrictVendorsText(strictVendors);
      setStrictRoutingEnabled(payload.data?.enabled !== false);
    } catch (error) {
      toast.error(error.message || 'Failed to load extraction routing settings');
    } finally {
      setLoadingRouting(false);
    }
  };

  const saveExtractionRouting = async () => {
    setSavingRouting(true);
    try {
      const strictVendors = strictVendorsText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const response = await fetch('/api/admin/settings/extractionRouting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({
          enabled: Boolean(strictRoutingEnabled),
          strictVendors,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Failed to save extraction routing settings');
      toast.success('Extraction routing settings saved');
    } catch (error) {
      toast.error(error.message || 'Failed to save extraction routing settings');
    } finally {
      setSavingRouting(false);
    }
  };

  useEffect(() => {
    loadExtractionRouting();
  }, []);

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
            <p className="font-bold text-base mb-2">Strict Routing Vendors (Laptop/Phone)</p>
            <p className="text-sm text-gray-600 mb-3">
              Type exact vendor names here to force strict laptop/phone extraction. Vendors in this list use the two-layer phone/electronics flow, while others use the general `Product | Specs | Condition | Price` flow.
            </p>
            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={strictRoutingEnabled}
                onChange={(event) => setStrictRoutingEnabled(event.target.checked)}
                disabled={loadingRouting || savingRouting}
              />
              <span>Enable laptop/phone vendor routing</span>
            </label>
            <textarea
              value={strictVendorsText}
              onChange={(event) => setStrictVendorsText(event.target.value)}
              className="w-full min-h-[110px] border rounded-lg p-3"
              placeholder="Type vendor names (comma separated): Lala Ikeja, Isreal Ikeja, Horleytech Line"
              disabled={loadingRouting || savingRouting}
            />
            <p className="text-xs text-gray-500 mt-2">This is the exact place to enter vendors for laptop/phone logic. Enter names separated by commas.</p>
            <button
              type="button"
              onClick={saveExtractionRouting}
              disabled={loadingRouting || savingRouting}
              className="mt-3 bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-700 disabled:opacity-50"
            >
              {savingRouting ? 'Saving...' : 'Save Routing Settings'}
            </button>
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
