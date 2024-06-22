import { combineReducers } from 'redux';
import { persistReducer } from 'redux-persist';
import storage from 'redux-persist/es/storage';
import getAllUsersReducer from './admin/getUsersReducer';
import loginReducer from './auth/loginReducer';
import modeReducer from './mode/modeReducer';
// import requestGroovesReducer from "./groovesReducer.ts/requestGroovesReducer";

export const rootReducer = combineReducers({
  users: getAllUsersReducer,
  auth: loginReducer,
  mode: modeReducer,
});

const config = {
  key: 'whitelisted-reducers',
  storage,
};

export const persistedRootReducer = persistReducer(config, rootReducer);
