import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, Label, Modal } from 'flowbite-react';
import bgImg from '../../assets/background.jpg';
import { RxMix, RxRocket } from 'react-icons/rx';

// Import the user data
import { users } from '../../constants/user';

const Login = () => {
  const [openModal, setOpenModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  function onCloseModal() {
    setOpenModal(false);
    setEmail('');
    setPassword('');
  }

  const drop = {
    '--tw-ring-color': '#1A1C23',
    color: '#1A1C23',
    background: 'white',
    border: '1px solid #CCC',
    // Add other styles if needed
  };

  const enter = {
    '--tw-ring-color': '#E69500',
    color: 'white',
    background: '#ffa500',
    border: '1px solid #ffa500',
    // Add other styles if needed
  };

  const iconStyle = {
    width: '24px',
    height: '24px',
    paddingRight: '5px',
    // Add any other styles as needed
  };

  const backgroundImage = {
    backgroundImage: `url(${bgImg})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };

  const handleLogin = () => {
    // Check if the provided email and password match any user in the array
    const matchedUser = users.find(
      (users) => users.email === email && users.password === password
    );

    if (matchedUser) {
      // Navigate to the desired route (dashboard/iphones in this case)
      navigate('/dashboard/iphones');
    } else {
      // Display an alert for incorrect credentials
      alert('The username and password don’t match.');
    }
  };

  return (
    <>
      <div
        className="flex w-screen h-screen overflow-hidden justify-center items-center"
        style={backgroundImage}
      >
        <Button
          className="flex items-center text-black"
          style={drop}
          onClick={() => setOpenModal(true)}
        >
          <RxRocket className="w-6" />
          Welcome back, User!
        </Button>
        <Modal
          className="fixed inset-0 z-50 flex w-screen h-full items-center justify-center backdrop-filter backdrop-blur-sm"
          show={openModal}
          size="md"
          onClose={onCloseModal}
          popup
        >
          <div className="fixed w-[97.5%] h-[96.5%] flex justify-center items-center">
            <div className="w-[400px] bg-white px-8 pt-5 pb-10 rounded-2xl shadow-lg">
              <Modal.Header />
              <Modal.Body>
                <div className="space-y-6">
                  <h3 className="flex items-center text-xl font-medium text-gray-900">
                    <RxMix style={iconStyle} />
                    Sign in to our platform
                  </h3>
                  <div>
                    <div className="mb-2 block text-black">
                      <label htmlFor="email" value="Your email" />
                    </div>
                    {/* <TextInput
                      id="email"
                      className="text-black"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    /> */}
                    <input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="name@company.com"
                      className="w-full p-3 rounded-md border border-black"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <div className="mb-2 block text-black">
                      <label htmlFor="password" value="Your password" />
                    </div>
                    <input
                      id="password"
                      type="password"
                      name="password"
                      placeholder="Enter Password"
                      className="w-full p-3 rounded-md border border-black"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                  <div className="flex justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox id="remember" />
                      <Label htmlFor="remember">Remember me</Label>
                    </div>
                    <a
                      href="#"
                      className="text-sm text-[#ffa500] hover:underline dark:text-[#ffa500]"
                    >
                      Lost Password?
                    </a>
                  </div>
                  <div className="w-full">
                    <Button style={enter} onClick={handleLogin}>
                      Log in to your account
                    </Button>
                  </div>
                  <div className="flex justify-between text-sm font-medium text-gray-500 dark:text-gray-300">
                    Not registered?&nbsp;
                    <a
                      href="#"
                      className="text-[#ffa500] hover:underline dark:text-[#ffa500]"
                    >
                      Create account
                    </a>
                  </div>
                </div>
              </Modal.Body>
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
};

export default Login;
