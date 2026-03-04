import { useNavigate } from 'react-router-dom';
import { FaDatabase } from 'react-icons/fa';
import { IoChatbubbleEllipses } from 'react-icons/io5';

const AppHub = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-5xl text-white">
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Welcome to Horleytech Portal</h1>
          <p className="mt-4 text-slate-200 text-base md:text-lg">Choose a module to continue.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate('/admin/dashboard')}
            className="group rounded-2xl border border-white/20 bg-white/10 backdrop-blur-lg p-8 text-left shadow-xl transition-all duration-300 hover:-translate-y-1 hover:bg-white/20"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Module</p>
                <h2 className="mt-2 text-2xl font-semibold">Inventory</h2>
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
                <h2 className="mt-2 text-2xl font-semibold">Live Requests</h2>
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
