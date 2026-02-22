import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import TechLogin from './pages/authPages/login';
import Dashboard from './pages/adminDashboard/Dashboard';
import VendorPage from './pages/VendorPage';
import UploadData from './pages/adminDashboardPages/UploadData';
import AutoListen from './pages/adminDashboardPages/AutoListen';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<TechLogin />} />
      
      {/* 🔴 PUBLIC ROUTE: Anyone with the link can view a vendor's inventory */}
      <Route path="/vendor/:vendorId" element={<VendorPage />} />

      {/* 🟢 PROTECTED ROUTES: Only logged-in admins can access the main dashboard */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      >
        <Route path="upload" element={<UploadData />} />
        <Route path="autolisten" element={<AutoListen />} />
      </Route>
    </Routes>
  );
}

export default App;
