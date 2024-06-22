import { BASE_URL } from "../constants/apiConstants";
import axios from "axios";
import { toast } from "react-toastify";


const createMenteeAccount = async () => {

    const config = {
        headers: {
            "Content-Type": "application/json",
            // 'Authorization': `Bearer ${token}`
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

const userService = {
    createMenteeAccount
}

export default userService 
