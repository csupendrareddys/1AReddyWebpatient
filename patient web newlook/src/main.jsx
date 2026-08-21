import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './app/store'
import App from './App'
import AuthInitializer from './features/auth/components/AuthInitializer/AuthInitializer'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <Provider store={store}>
            <BrowserRouter>
                <AuthInitializer>
                    <App />
                </AuthInitializer>
            </BrowserRouter>
        </Provider>
    </React.StrictMode>,
)
