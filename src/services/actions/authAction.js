import { BASE_URL } from "../constants/apiConstants";
import axios from "axios";
import { toast } from "react-toastify";


const loginAccount = async ({email, password}) => {
    
    const config = {
        headers: {
            "Content-Type": "application/json",
        },
    };

    try {
        const { data } = await axios.post(`${BASE_URL}/auth/login`, {email, password}, config)
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


const authService = {
    loginAccount
}

export default authService 
