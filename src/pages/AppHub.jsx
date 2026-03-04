import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { useDispatch } from 'react-redux';
import { FaDatabase } from 'react-icons/fa';
import { IoChatbubbleEllipses } from 'react-icons/io5';
import Logo from '../assets/logo.png';
import { logout } from '../services/reducers/auth/loginReducer';
import { auth } from '../services/firebase';

const AppHub = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign out failed:', error);
    } finally {
      localStorage.clear();
      dispatch(logout());
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <header className="mb-8 flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-lg sm:px-6">
          <button type="button" className="cursor-pointer transition-opacity hover:opacity-80" onClick={() => navigate('/hub')}>
            <img src={Logo} alt="Horleytech" className="h-8 w-auto sm:h-10" />
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-red-300 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 shadow-md transition hover:bg-red-500/30"
          >
            Logout
          </button>
        </header>

        <div className="text-center text-white mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">Welcome to Horleytech Portal</h1>
          <p className="mt-4 text-slate-200 text-sm sm:text-base md:text-lg">Choose a module to continue.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="group rounded-2xl border border-white/20 bg-white/10 backdrop-blur-lg p-8 text-left shadow-xl transition-all duration-300 hover:-translate-y-1 hover:bg-white/20"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Module</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Inventory</h2>
                <p className="mt-3 text-slate-200">View and manage global inventory data.</p>
              </div>
              <FaDatabase className="h-14 w-14 text-orange-300 group-hover:text-orange-200" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => {}}
            className="group rounded-2xl border border-white/20 bg-white/10 backdrop-blur-lg p-8 text-left shadow-xl transition-all duration-300 hover:bg-white/20"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Module</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Live Requests</h2>
                <p className="mt-3 text-slate-200">Real-time request handling and internal messaging.</p>
              </div>
              <IoChatbubbleEllipses className="h-14 w-14 text-sky-300 group-hover:text-sky-200" />
            </div>
            <span className="inline-flex mt-5 items-center rounded-full bg-amber-400/20 border border-amber-300/40 px-3 py-1 text-xs font-semibold text-amber-200">
              Coming Soon
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppHub;
