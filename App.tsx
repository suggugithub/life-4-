import React, { useState, useEffect } from 'react';
import { User } from './types';
import { onAuthUserChanged } from './services/firebaseService';
import AuthScreen from './components/AuthScreen';
import ApplicationLayout from './components/ApplicationLayout'; // This will be the new main app component
import { ICONS } from './constants';

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [globalError, setGlobalError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthUserChanged((authUser) => {
            setUser(authUser);
            setLoading(false);
        });
        return () => unsubscribe(); // Cleanup subscription on unmount
    }, []);

    useEffect(() => {
        if (globalError) {
            const timer = setTimeout(() => {
                setGlobalError(null);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [globalError]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50">
                <div className="animate-spin rounded-full h-24 w-24 border-t-4 border-b-4 border-blue-600"></div>
            </div>
        );
    }

    return (
        <>
            {user ? (
                <ApplicationLayout user={user} setGlobalError={setGlobalError} />
            ) : (
                <AuthScreen setGlobalError={setGlobalError} />
            )}
            {globalError && (
                <div 
                    className="fixed bottom-5 right-5 bg-red-600 text-white p-4 rounded-xl shadow-2xl z-[100] max-w-md w-full animate-fade-in-up" 
                    role="alert"
                >
                    <div className="flex items-start">
                        <div className="flex-shrink-0 pt-0.5">
                            <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="ml-3 flex-1">
                            <p className="font-bold text-base">An Error Occurred</p>
                            <p className="text-sm mt-1">{globalError}</p>
                        </div>
                         <button 
                            onClick={() => setGlobalError(null)} 
                            className="ml-auto -mr-1 -mt-1 p-1 rounded-full hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-white transition-colors"
                            aria-label="Close"
                          >
                           <span className="sr-only">Close</span>
                           <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default App;