import React, { useState } from 'react';
import { ICONS } from '../constants';
import { signIn, signUp, resetPassword, signInWithGoogle } from '../services/firebaseService';

// --- Reusable Auth Components (Moved outside main component to prevent re-renders) ---

const AuthCard: React.FC<{ children: React.ReactNode, title: string, subtitle?: string }> = ({ children, title, subtitle }) => (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-lg">
        <div className="flex flex-col items-center space-y-2">
            <span className="text-blue-600">{ICONS.logo}</span>
            <h1 className="text-3xl font-bold text-slate-800">{title}</h1>
            {subtitle && <p className="text-center text-slate-500">{subtitle}</p>}
        </div>
        {children}
    </div>
);

const AuthInput: React.FC<{ id: string, type: string, placeholder: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, children?: React.ReactNode }> = ({ id, type, placeholder, value, onChange, children }) => (
    <div className="relative">
        <input id={id} type={type} placeholder={placeholder} value={value} onChange={onChange} className="w-full px-4 py-3 bg-slate-100 border-2 border-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-blue-500 transition-all" required />
        {children}
    </div>
);

const AuthButton: React.FC<{ loading: boolean, text: string }> = ({ loading, text }) => (
     <button type="submit" disabled={loading} className="w-full flex justify-center items-center px-4 py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-all duration-300 transform hover:scale-105 shadow-md hover:shadow-lg">
        {loading ? ICONS.loadingSpinner : text}
    </button>
);

const GoogleSignInButton: React.FC<{ onClick: () => void, loading: boolean }> = ({ onClick, loading }) => (
    <button type="button" onClick={onClick} disabled={loading} className="w-full flex justify-center items-center gap-3 px-4 py-3 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:bg-slate-200 transition-all duration-300 transform hover:scale-105 shadow-sm hover:shadow-md">
        {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-slate-600"></div> : ICONS.google}
        Sign in with Google
    </button>
);

// --- Main Auth Screen Component ---

interface AuthScreenProps {
  setGlobalError: (message: string | null) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ setGlobalError }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);

    const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault(); 
        setLoading(true); 
        setGlobalError(null);
        try {
            if (isLogin) {
                await signIn(email, password);
            } else {
                await signUp(email, password);
            }
            // onAuthStateChanged in App.tsx will handle navigation
        } catch (error: any) { 
            if (isLogin) {
                if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email' || error.code === 'auth/invalid-credential') {
                    setGlobalError("Incorrect password or email. Please try again or sign up.");
                } else {
                    setGlobalError(error.message || "An unknown authentication error occurred.");
                }
            } else {
                if (error.code === 'auth/email-already-in-use') {
                    setGlobalError("This email is already in use. Please try logging in.");
                } else {
                    setGlobalError(error.message || "An unknown authentication error occurred.");
                }
            }
        } finally { 
            setLoading(false); 
        }
    };
    
    const handleGoogleSignIn = async () => {
        setIsGoogleLoading(true);
        setGlobalError(null);
        try {
            await signInWithGoogle();
             // onAuthStateChanged in App.tsx will handle navigation
        } catch (error: any) {
            if (error.code === 'auth/popup-closed-by-user') {
                 setGlobalError("Sign-in process was cancelled.");
            } else {
                 setGlobalError(error.message || "An error occurred during Google Sign-In.");
            }
        } finally {
            setIsGoogleLoading(false);
        }
    };

    const handlePasswordReset = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault(); 
        setLoading(true); 
        setGlobalError(null);
        try {
            await resetPassword(email);
            alert('Password reset email sent! Please check your inbox.');
            setIsForgotPassword(false);
            setEmail(''); // Clear email after sending reset
        } catch (error: any) { 
            setGlobalError(error.message || "Failed to send password reset email."); 
        } finally { 
            setLoading(false); 
        }
    };
    
    if (isForgotPassword) {
        return (
            <div className="flex items-start sm:items-center justify-center min-h-screen bg-slate-50 p-4 pt-12 sm:pt-4">
                <AuthCard title="Reset Password">
                     <p className="text-sm text-center text-slate-500 !-mt-4 !mb-6">Enter your email to get a password reset link.</p>
                     <form onSubmit={handlePasswordReset} className="space-y-6">
                        <AuthInput id="email-reset" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                        <AuthButton loading={loading} text="Send Reset Email" />
                    </form>
                    <button onClick={() => {setIsForgotPassword(false); setGlobalError(null);}} className="w-full mt-4 text-sm font-medium text-center text-blue-600 hover:underline">Back to Login</button>
                </AuthCard>
            </div>
        )
    }

    return (
        <div className="flex items-start sm:items-center justify-center min-h-screen bg-slate-50 p-4 pt-12 sm:pt-4">
            <AuthCard 
              title="AI Eisenhower Matrix"
              subtitle={isLogin ? "Let AI help you focus on what truly matters." : "Create your account to get started."}
            >
                
                <GoogleSignInButton onClick={handleGoogleSignIn} loading={isGoogleLoading} />

                <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-300"></div>
                    <span className="flex-shrink mx-4 text-slate-400 text-sm font-medium">OR</span>
                    <div className="flex-grow border-t border-slate-300"></div>
                </div>

                <form onSubmit={handleEmailSubmit} className="space-y-4">
                    <AuthInput id="email-auth" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <AuthInput id="password-auth" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}>
                       <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-500 hover:text-blue-600" aria-label={showPassword ? "Hide password" : "Show password"}>
                           {showPassword ? ICONS.eyeOpen : ICONS.eyeClosed}
                       </button>
                    </AuthInput>

                    <div className="flex items-center justify-end">
                        {isLogin && <button type="button" onClick={() => {setIsForgotPassword(true); setGlobalError(null);}} className="text-sm font-medium text-blue-600 hover:underline">Forgot Password?</button>}
                    </div>

                    <AuthButton loading={loading} text={isLogin ? 'Login' : 'Sign Up'} />
                </form>

                <p className="text-sm text-center text-slate-500 pt-4">
                    {isLogin ? "Don't have an account?" : 'Already have an account?'}
                    <button onClick={() => {setIsLogin(!isLogin); setGlobalError(null);}} className="ml-1 font-semibold text-blue-600 hover:underline">
                        {isLogin ? 'Sign Up' : 'Login'}
                    </button>
                </p>
            </AuthCard>
        </div>
    );
};

export default AuthScreen;