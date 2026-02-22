import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, Label, Modal } from 'flowbite-react';
import { useDispatch, useSelector } from 'react-redux';
import bgImg from '../../assets/background.jpg';
import { RxMix, RxRocket } from 'react-icons/rx';
import { users } from '../../constants/user';
import { setAuthenticatedUser } from '../../services/reducers/auth/loginReducer';

const Login = () => {
  const [openModal, setOpenModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { isAuthenticated } = useSelector((state) => state.auth);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  function onCloseModal() {
    setOpenModal(false);
    setEmail('');
    setPassword('');
    setLoginError('');
  }

  const drop = {
    '--tw-ring-color': '#1A1C23',
    color: '#1A1C23',
    background: 'white',
    border: '1px solid #CCC',
  };

  const enter = {
    '--tw-ring-color': '#E69500',
    color: 'white',
    background: '#ffa500',
    border: '1px solid #ffa500',
  };

  const iconStyle = { width: '24px', height: '24px', paddingRight: '5px' };

  const backgroundImage = {
    backgroundImage: `url(${bgImg})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };

  const handleLogin = () => {
    const matchedUser = users.find((item) => item.email === email && item.password === password);

    if (matchedUser) {
      dispatch(
        setAuthenticatedUser({
          user: { id: matchedUser.id, email: matchedUser.email },
          token: `local-${matchedUser.id}`,
        })
      );
      navigate('/dashboard', { replace: true });
    } else {
      setLoginError('The username and password don’t match.');
    }
  };

  return (
    <div className="flex w-screen h-screen overflow-hidden justify-center items-center" style={backgroundImage}>
      <Button className="flex items-center text-black" style={drop} onClick={() => setOpenModal(true)}>
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
                {loginError && <p className="text-sm font-semibold text-red-600">{loginError}</p>}
                <div className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox id="remember" />
                    <Label htmlFor="remember">Remember me</Label>
                  </div>
                  <a href="#" className="text-sm text-[#ffa500] hover:underline dark:text-[#ffa500]">
                    Lost Password?
                  </a>
                </div>
                <div className="w-full">
                  <Button style={enter} onClick={handleLogin}>
                    Log in to your account
                  </Button>
                </div>
              </div>
            </Modal.Body>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Login;
