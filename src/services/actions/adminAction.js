import { BASE_URL } from "../constants/apiConstants";
import axios from "axios";
import { toast } from "react-toastify";


const getAllUsers = async ({token}) => {

    const config = {
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`
        },
    };

    try {
        const { data } = await axios.get(`${BASE_URL}/admin/users`, config)
        return data
    } catch (error) {
        const message =
            (error.response &&
                error.response.data &&
                error.response.data.message) ||
            error.message ||
            error.toString();
        toast.error(`${message}`);
    }
}


const approveUserAccount = async ({token, id}) => {
    const config = {
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`
        },
    };

    try {
        const { data } = await axios.put(`${BASE_URL}/admin/approve-user`,{id}, config)
        return data?.data
    } catch (error) {
        const message =
            (error.response &&
                error.response.data &&
                error.response.data.message) ||
            error.message ||
            error.toString();
        toast.error(`${message}`);
    }
}

const deleteUserAccount = async ({token, id}) => {
    const config = {
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`
        },
    };

    try {
        const { data } = await axios.delete(`${BASE_URL}/admin/delete-user/${id}`, config)
        return data?.data
    } catch (error) {
        const message =
            (error.response &&
                error.response.data &&
                error.response.data.message) ||
            error.message ||
            error.toString();
        toast.error(`${message}`);
    }
}

const createMentorAccount = async (details) => {
    const config = {
        headers: {
            "Content-Type": "application/json",
            // 'Authorization': `Bearer ${token}`
        },
    };

    try {
        const { data } = await axios.post(`${BASE_URL}/admin/create-user`,details, config)
        return data?.data
    } catch (error) {
        const message =
            (error.response &&
                error.response.data &&
                error.response.data.message) ||
            error.message ||
            error.toString();
        toast.error(`${message}`);
    }
}

const disableUserAccount = async ({token, id}) => {
    const config = {
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`
        },
    };

    try {
        const { data } = await axios.put(`${BASE_URL}/admin/deactivate-user`,{id}, config)
        return data?.data
    } catch (error) {
        const message =
            (error.response &&
                error.response.data &&
                error.response.data.message) ||
            error.message ||
            error.toString();
        toast.error(`${message}`);
    }
}



const adminService = {
    getAllUsers,
    approveUserAccount,
    deleteUserAccount,
    createMentorAccount,
    disableUserAccount
}

export default adminService 