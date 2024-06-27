import { useEffect } from 'react';
import { useState } from 'react';
import { BsFillCpuFill } from 'react-icons/bs';
import { MutatingDots } from 'react-loader-spinner';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { db } from '../../services/firebase';
import { generateRandomString } from '../../services/utils/generateString';

const Ai = () => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  // const [pricesData, setPricesData] = useState(null);
  const [responseMessage, setResponseMessage] = useState('');
  const [success, setSuccess] = useState(false);

  const dummyData = [
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
  ];

  // FIREBASE...
  // Add a group
  const addGroup = async () => {
    const docRef = await addDoc(collection(db, 'groups'), {
      name: title.trim(),
    });
    console.log('Document written with ID: ', docRef.id);
    return docRef;
  };

  const addPrices = async (pricesData) => {
    const batch = writeBatch(db);
    pricesData = JSON.parse(pricesData);

    pricesData.forEach((priceDatum) => {
      const datumRef = doc(db, 'prices', generateRandomString(10));
      batch.set(datumRef, { ...priceDatum, group: title });
    });

    await batch.commit();
  };

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setMessageIndex((prevIndex) => (prevIndex + 1) % messages.length);
      }, 2000); // Change message every 2 seconds
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    console.log({ file });
  }, [file]);

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

    fetch('http://localhost:8000/process', {
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
            data.message || 'Error uploading file. Probably too large.'
          );
          setSuccess(false);
          setLoading(false);
          toast(data.message || 'Error');
          return;
        }
        // handleAiResponse(data);
        if (data.length > 0) {
          const firebaseGroupResponse = await addGroup();
          console.log({ firebaseGroupResponse });

          await addPrices(data);
        }
        setResponseMessage('Successfullly Uploaded Data');
        setLoading(false);
        setSuccess(true);
        setFile(null);
        setTitle('');
        toast('Successfully Analyzed');
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
