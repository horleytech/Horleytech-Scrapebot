import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { FaTrash } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { db } from '../../services/firebase';

const MAX_STAFF = 5;

const TeamManagement = () => {
  const [staffList, setStaffList] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const canAddStaff = useMemo(() => staffList.length < MAX_STAFF, [staffList.length]);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(collection(db, 'horleyTech_Staff'));
      const users = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setStaffList(users);
    } catch (loadError) {
      setError('Unable to fetch team members right now.');
      console.error(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleAddStaff = async (event) => {
    event.preventDefault();
    if (!canAddStaff) return;
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password.trim()) {
      setError('Username and password are required.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const existingStaff = await getDocs(query(collection(db, 'horleyTech_Staff'), where('username', '==', trimmedUsername)));
      if (!existingStaff.empty) {
        setError('This username already exists.');
        setLoading(false);
        return;
      }

      const currentCount = await getDocs(collection(db, 'horleyTech_Staff'));
      if (currentCount.size >= MAX_STAFF) {
        setError('Maximum of 5 staff members reached.');
        setLoading(false);
        return;
      }

      await addDoc(collection(db, 'horleyTech_Staff'), {
        username: trimmedUsername,
        password: password.trim(),
      });
      setUsername('');
      setPassword('');
      await loadStaff();
    } catch (addError) {
      setError('Unable to add staff right now.');
      console.error(addError);
      setLoading(false);
    }
  };

  const handleDelete = async (staff) => {
    const typedValue = window.prompt(`To delete ${staff.username}, type DELETE below to confirm.`);
    if (typedValue !== 'DELETE') return;

    setLoading(true);
    setError('');
    try {
      await deleteDoc(doc(db, 'horleyTech_Staff', staff.id));
      await loadStaff();
    } catch (deleteError) {
      setError('Unable to delete this staff member.');
      console.error(deleteError);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
        type="button"
        onClick={() => navigate('/hub')}
        className="inline-flex items-center text-sm font-medium text-slate-700 transition hover:text-slate-900"
      >
        ← Back to Hub
      </button>
      <div className="bg-white rounded-xl shadow p-6 border border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Team Management</h1>
        <p className="text-slate-600 mt-1">Create and manage staff accounts (maximum 5).</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Staff</h2>
        <form onSubmit={handleAddStaff} className="grid gap-4 md:grid-cols-3 md:items-end">
          <div>
            <label htmlFor="staff-username" className="block text-sm text-slate-700 mb-1">Username</label>
            <input
              id="staff-username"
              type="text"
              className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={!canAddStaff || loading}
            />
          </div>
          <div>
            <label htmlFor="staff-password" className="block text-sm text-slate-700 mb-1">Password</label>
            <input
              id="staff-password"
              type="password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!canAddStaff || loading}
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-md bg-slate-900 text-white px-4 font-medium disabled:opacity-50"
            disabled={!canAddStaff || loading}
          >
            Add Staff
          </button>
        </form>
        {!canAddStaff && <p className="text-amber-600 text-sm mt-3">Maximum of 5 staff members reached.</p>}
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>

      <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Username</th>
              <th className="text-left px-4 py-3 font-semibold">Password</th>
              <th className="text-right px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {staffList.map((staff) => (
              <tr key={staff.id} className="border-t border-slate-200">
                <td className="px-4 py-3">{staff.username}</td>
                <td className="px-4 py-3">{staff.password}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center text-red-600 hover:text-red-700"
                    onClick={() => handleDelete(staff)}
                    disabled={loading}
                  >
                    <FaTrash className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!staffList.length && !loading && (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={3}>No staff members yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TeamManagement;
