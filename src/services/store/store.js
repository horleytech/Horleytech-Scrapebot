import { configureStore } from '@reduxjs/toolkit';
import { persistStore } from 'redux-persist';
import { persistedRootReducer } from '../reducers';



export const store = configureStore({
    reducer: persistedRootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
        serializableCheck: false,
    })
});

export const persiststore = persistStore(store);