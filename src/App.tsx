import React, { useState, useCallback, useEffect } from 'react';
import ReactGA from 'react-ga4';
import { FileText, Upload, Database, Download, AlertCircle, Info, Loader2, ChevronRight, Search, FileUp, Copy, Check, LogIn, LogOut, History, Save, Table, User as UserIcon, RotateCcw, ExternalLink, X, Clock, Coins, ArrowUpRight, ArrowDownLeft, Activity, Beaker, CheckCircle2, Zap, CircleDollarSign, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// Types
import { AppState, ExtractionResult, Antibody, UserProfile, ActivityLog, Account } from './types';
import { extractWithLLM, LLMProvider, LLMOptions } from './services/llm';
import { fetchTargetMetadata } from './services/uniprot';
import { SequenceDisplay } from './components/SequenceDisplay';
import { auth, signIn, logout, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User, signInAnonymously, updateProfile, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, doc, updateDoc, deleteDoc, setDoc, getDocFromServer, limit } from 'firebase/firestore';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AntibodyIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.5" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M12 12L4 4" />
    <path d="M12 12L20 4" />
    <path d="M12 12V22" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

const LoadingScreen = ({ status, timer, batchProgress }: { status?: string, timer: number, batchProgress?: { current: number, total: number } }) => {
  const steps = [
    "Identifying Variable Patterns",
    "Processing Multimodal Signals",
    "Validating Verbatim Integrity",
    "Synchronizing CDR Coordinates",
    "Generating Extraction Summary"
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white p-8">
      <div className="relative mb-12">
        {/* Modern Loader Ring - Simple and Clean per screenshot */}
        <div className="w-32 h-32 rounded-full border-4 border-indigo-50 relative flex items-center justify-center">
          <div 
            className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-600 border-r-indigo-600 border-b-indigo-600 animate-spin" 
          />
          <Database className="w-10 h-10 text-indigo-600" />
        </div>
      </div>
      
      <h2 className="text-2xl font-bold text-zinc-900 mb-4 tracking-tight">
        Antibody Extraction in Progress
      </h2>
      
      <div className="mb-10">
        <span className="px-5 py-1.5 bg-zinc-900 text-white rounded-full text-lg font-bold font-mono tracking-tight shadow-lg">
          {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
        </span>
      </div>
      
      <div className="flex flex-col gap-3 text-center mb-10">
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <p 
              key={i} 
              className={cn(
                "text-[11px] font-bold tracking-[0.2em] uppercase transition-all duration-700",
                i === Math.floor((timer / 5) % steps.length) ? "text-indigo-600 opacity-100 scale-105" : "text-zinc-200 opacity-40"
              )}
            >
              {step}
            </p>
          ))}
        </div>

        {status && (
          <motion.div
            key={status}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-6 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-full inline-flex items-center gap-2 self-center shadow-sm"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">{status}</span>
          </motion.div>
        )}
      </div>

      {batchProgress && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="px-10 py-5 bg-zinc-900 rounded-[32px] shadow-2xl text-center border border-white/5"
        >
          <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-2 leading-none">
            Queue Progress
          </p>
          <p className="text-4xl font-black font-mono text-white tracking-tighter">
             {batchProgress.current}<span className="text-white/20 mx-1 text-2xl">/</span>{batchProgress.total}
          </p>
          <div className="w-full h-1.5 bg-white/10 rounded-full mt-4 overflow-hidden">
            <motion.div 
              className="h-full bg-indigo-500"
              initial={{ width: 0 }}
              animate={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </motion.div>
      )}
    </div>
  );
};

// Error Boundary Component
class ErrorBoundary extends React.Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl border border-red-100">
            <AlertCircle className="w-12 h-12 text-red-600 mb-4" />
            <h2 className="text-xl font-bold text-red-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-red-700 mb-6 font-mono break-all">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 text-white py-2 rounded-xl font-medium hover:bg-red-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

function AppContent() {
  const [state, setState] = useState<AppState>({
    isExtracting: false,
    result: null,
    error: null,
    batch: {
      isProcessing: false,
      items: [],
      currentIndex: -1
    }
  });
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [llmOptions, setLlmOptions] = useState<LLMOptions>({
    provider: 'gemma',
    model: 'gemma-4',
    isSarMode: false
  });
  const [pageRange, setPageRange] = useState('');
  const [prioritySeqIds, setPrioritySeqIds] = useState('');
  const [sequenceListingFile, setSequenceListingFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [forceLoadHistory, setForceLoadHistory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [requestAccessForm, setRequestAccessForm] = useState({ name: '', email: '', message: '' });
  const [requestStatus, setRequestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const intendedRoleRef = React.useRef<string | null>(null);

  const [timer, setTimer] = useState(0);
  const [sessionLogged, setSessionLogged] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [healthInfo, setHealthInfo] = useState<any>(null);
  const [networkStats, setNetworkStats] = useState({ 
    online: navigator.onLine, 
    latency: -1,
    lastChecked: new Date()
  });

  const MODEL_RATES = {
    'gemini-3.1-pro-preview': { input: 1.25, output: 5.0 }, // Estimates based on 1.5 Pro pricing
    'gemini-3-flash-preview': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash-preview': { input: 0.075, output: 0.30 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1-preview': { input: 15.0, output: 60.0 },
    'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-latest': { input: 0.25, output: 1.25 },
    'claude-3-opus-latest': { input: 15.0, output: 75.0 },
    'gemma-4': { input: 0, output: 0, free: true },
  };

  const getEstCost = (usage: any, modelUsed: string) => {
    if (!usage) return '---';
    const rateKey = Object.keys(MODEL_RATES).find(k => modelUsed.includes(k)) || 'gemini-3.1-pro-preview';
    const rates = (MODEL_RATES as any)[rateKey] as { input: number, output: number, free?: boolean };
    
    if (rates.free) return 'FREE';
    
    const inputCost = (usage.promptTokenCount / 1000000) * rates.input;
    const outputTokens = usage.totalTokenCount - usage.promptTokenCount;
    const outputCost = (outputTokens / 1000000) * rates.output;
    
    return `$${(inputCost + outputCost).toFixed(4)}`;
  };

  const formatErrorMessage = (error: string) => {
    try {
      const parsed = JSON.parse(error);
      if (parsed.error && parsed.error.message) {
        if (parsed.error.code === 503 || parsed.error.status === "UNAVAILABLE") 
          return "The AI engine is currently over capacity due to high demand. Please try your extraction again in 30 seconds.";
        if (parsed.error.code === 429) 
          return "Rate limit reached. We've processed many requests recently - please wait a minute before the next run.";
        if (parsed.error.code === 403)
          return "Access denied. Your session may have expired or you don't have permission for this model.";
        return parsed.error.message;
      }
    } catch(e) {}
    if (error.includes('token count exceeds') || error.includes('262144')) 
      return "Document too large for Gemma 4 (256k limit). Please switch to Gemini 3.1 Pro (1M+ limit) or use a text-only subset.";
    if (error.includes('503')) return "The extraction service is temporarily unavailable. Please try again shortly.";
    if (error.includes('429')) return "Too many requests. Please wait a moment before trying again.";
    if (error.includes('timeout')) return "The request timed out. High-volume patents may require using a specific page range.";
    if (error.includes('fetch')) return "Network error: Could not reach the extraction server. Check your connection.";
    return error;
  };

  useEffect(() => {
    const handleOnline = () => setNetworkStats(prev => ({ ...prev, online: true }));
    const handleOffline = () => setNetworkStats(prev => ({ ...prev, online: false }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    const interval = setInterval(async () => {
      const start = Date.now();
      try {
        const res = await fetch('/api/health?ping=' + start, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setHealthInfo(data);
          setNetworkStats(prev => ({ 
            ...prev, 
            latency: Date.now() - start, 
            lastChecked: new Date(),
            online: true 
          }));
        }
      } catch (e) {
        setNetworkStats(prev => ({ ...prev, online: false, latency: -1 }));
      }
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        setHealthInfo(await res.json());
      }
    } catch (err) {
      console.error('Health check failed:', err);
    }
  };

  const testApi = async () => {
    try {
      const start = Date.now();
      const baseUrl = window.location.origin;
      const res = await fetch(`${baseUrl}/api/extract?t=${start}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          provider: 'gemini',
          input: "Test input for reachability check.",
          systemInstruction: "Respond with 'ok'",
          test: true 
        })
      });
      const end = Date.now();
      const data = await res.json();
      alert(`API Test: ${res.status} ${res.statusText} (${end - start}ms)\nJob ID: ${data.jobId || 'none'}`);
      if (!res.ok) {
        console.error('API Test Response Not OK:', res.status, res.statusText, data);
      }
    } catch (err: any) {
      alert(`API Test Failed: ${err.message}. Check console for details.`);
      console.error('API Test Failed - Full Error:', err);
      console.error('Current Origin:', window.location.origin);
      console.error('Current Protocol:', window.location.protocol);
      console.error('Browser Online:', navigator.onLine);
    }
  };

  const pingServer = async () => {
    try {
      const start = Date.now();
      const res = await fetch(`/api/health?t=${start}`);
      const end = Date.now();
      if (res.ok) {
        const data = await res.json();
        alert(`Server Ping: OK (${end - start}ms)\nVersion: ${data.version}`);
      } else {
        alert(`Server Ping: Failed (${res.status})`);
      }
    } catch (err: any) {
      alert(`Server Ping: Error - ${err.message}`);
    }
  };

  useEffect(() => {
    if (showDebug) checkHealth();
  }, [showDebug]);

  // Initialize GA4
  useEffect(() => {
    const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    if (measurementId) {
      ReactGA.initialize(measurementId);
      ReactGA.send({ hitType: "pageview", page: window.location.pathname });
    }
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setIsAuthLoading(true);
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDocFromServer(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            
            if (userData.disabled && userData.role !== 'admin') {
              await auth.signOut();
              setLoginError('Your account has been disabled by an administrator.');
              setIsAuthLoading(false);
              setIsAuthReady(true);
              return;
            }

            const profile: UserProfile = {
              uid: u.uid,
              accountId: userData.accountId,
              email: u.email,
              displayName: u.displayName || userData.displayName || (u.isAnonymous ? 'Guest Researcher' : 'User'),
              photoURL: u.photoURL,
              role: userData.role || (u.isAnonymous ? 'guest' : 'user'),
              isAnonymous: u.isAnonymous,
              createdAt: userData.createdAt
            };
            setUser(profile);
            
            // Check if account is disabled
            if (profile.accountId) {
              const accountSnap = await getDocFromServer(doc(db, 'accounts', profile.accountId));
              if (accountSnap.exists() && accountSnap.data().disabled) {
                await auth.signOut();
                setLoginError('This account has been disabled by an administrator.');
                setIsAuthLoading(false);
                setIsAuthReady(true);
                return;
              }
            }
            
            // Default guests to Scientific Discovery Engine (Gemma 4)
            if (profile.role === 'guest') {
              setLlmOptions({ provider: 'gemma', model: 'gemma-4', isSarMode: false });
            }
          } else {
            // New user or anonymous session without doc
            const role = intendedRoleRef.current || (u.isAnonymous ? 'guest' : 'user');
            const newUser: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || (role === 'admin' ? 'Admin' : u.isAnonymous ? 'Guest Researcher' : 'User'),
              photoURL: u.photoURL || null,
              role: role,
              isAnonymous: u.isAnonymous,
              createdAt: Timestamp.now()
            };
            
            // Only create doc if not anonymous or if we want to persist guest info
            // For now, let's create it to ensure isAdmin() works for anonymous admins
            await setDoc(userRef, newUser).catch(err => {
              console.error('Failed to create user doc:', err);
              // Don't throw here, just log. We'll fallback to basic info.
            });
            setUser(newUser);
            
            if (role === 'guest') {
              setLlmOptions({ provider: 'gemma', model: 'gemma-4', isSarMode: false });
            }
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          // Fallback to basic user info if Firestore fails
          const role = intendedRoleRef.current || (u.isAnonymous ? 'guest' : 'user');
          setUser({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName || (role === 'admin' ? 'Admin' : u.isAnonymous ? 'Guest Researcher' : 'User'),
            photoURL: u.photoURL,
            role: role,
            isAnonymous: u.isAnonymous
          });
        }
      } else {
        intendedRoleRef.current = null;
        setUser(null);
        setState(prev => ({ ...prev, isExtracting: false, result: null, error: null }));
        setPageRange('');
        setShowAdminDashboard(false);
        setShowHistory(false);
      }
      setIsAuthLoading(false);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Session Login Logger
  useEffect(() => {
    if (user && !sessionLogged) {
      const logLogin = async () => {
        try {
          await addDoc(collection(db, 'activity_logs'), {
            userId: user.uid,
            userDisplayName: user.displayName || 'User',
            action: 'login',
            timestamp: Timestamp.now(),
            metadata: { role: user.role, method: user.isAnonymous ? 'anonymous' : 'google' }
          });
          setSessionLogged(true);
        } catch (err) {
          console.error('Failed to log login:', err);
        }
      };
      logLogin();
    }
    if (!user) {
      setSessionLogged(false);
    }
  }, [user, sessionLogged]);

  // Timer Logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (state.isExtracting || state.batch?.isProcessing) {
      if (state.isExtracting) setTimer(0);
      interval = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state.isExtracting, state.batch?.isProcessing]);

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const { username, password } = loginForm;
    
    const lowerUsername = username.toLowerCase();
    const isGuestUser = ['guest1', 'guest2', 'guest3'].includes(lowerUsername) && password === 'Guest1@';
    const isAdminUser = lowerUsername === 'admin' && password === 'Admin1@';

    if (isGuestUser || isAdminUser) {
      try {
        const role = isAdminUser ? 'admin' : 'guest';
        intendedRoleRef.current = role;
        
        // Set persistence to session for guest/admin logins to avoid "sticky" logins on public terminals
        await setPersistence(auth, browserSessionPersistence);
        
        const { user: anonUser } = await signInAnonymously(auth);
        
        // Use the actual current UID to avoid mismatch issues
        const currentUid = auth.currentUser?.uid || anonUser.uid;
        
        // Check account status AFTER login so we are authenticated
        const accountRef = doc(db, 'accounts', lowerUsername);
        const accountSnap = await getDocFromServer(accountRef);
        
        if (accountSnap.exists() && accountSnap.data().disabled) {
          await auth.signOut();
          setLoginError('This account has been disabled by an administrator.');
          return;
        }

        const displayName = isAdminUser ? 'Admin' : `Guest Curator (${username})`;
        await updateProfile(anonUser, { displayName });
        
        const userRef = doc(db, 'users', currentUid);
        const newUser: UserProfile = {
          uid: currentUid,
          accountId: lowerUsername,
          email: null,
          displayName,
          photoURL: null,
          role,
          isAnonymous: true,
          createdAt: Timestamp.now()
        };
        
        await setDoc(userRef, newUser).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUid}`));
        
        // Update account record
        await setDoc(accountRef, {
          id: lowerUsername,
          role,
          lastUid: currentUid,
          lastActive: Timestamp.now()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `accounts/${lowerUsername}`));
        
        // Log login activity
        await addDoc(collection(db, 'activity_logs'), {
          userId: currentUid,
          accountId: lowerUsername,
          userDisplayName: displayName,
          action: 'login',
          timestamp: Timestamp.now(),
          metadata: { role }
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'activity_logs'));

        // Track login event
        ReactGA.event({
          category: 'User',
          action: 'Login',
          label: role
        });

        setUser(newUser);
        setLoginError('');
        
        // Default to Scientific Discovery Engine for guests
        if (role === 'guest') {
          setLlmOptions({ provider: 'gemma', model: 'gemma-4', isSarMode: false });
        }
      } catch (err: any) {
        console.error('Login failed:', err);
        intendedRoleRef.current = null;
        setLoginError(err.message || 'Login failed. Please check your internet connection.');
      }
    } else {
      setLoginError('Invalid credentials');
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestAccessForm.name || !requestAccessForm.email || !requestAccessForm.message) return;
    
    setRequestStatus('sending');
    try {
      await addDoc(collection(db, 'access_requests'), {
        ...requestAccessForm,
        timestamp: Timestamp.now(),
        status: 'new'
      });
      setRequestStatus('success');
      setRequestAccessForm({ name: '', email: '', message: '' });
      setTimeout(() => setRequestStatus('idle'), 5000);
    } catch (err) {
      console.error('Request access failed:', err);
      setRequestStatus('error');
    }
  };

  const handleLogout = async () => {
    try {
      if (user) {
        // Log logout activity
        await addDoc(collection(db, 'activity_logs'), {
          userId: user.uid,
          userDisplayName: user.displayName || 'User',
          action: 'logout',
          timestamp: Timestamp.now()
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'activity_logs'));
      }
      
      if (auth.currentUser) {
        // Track logout event
        ReactGA.event({
          category: 'User',
          action: 'Logout'
        });
        await logout();
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setUser(null);
      setState(prev => ({ ...prev, isExtracting: false, result: null, error: null }));
      setPageRange('');
      setShowAdminDashboard(false);
      setShowHistory(false);
      setHistory([]);
      setActivityLogs([]);
    }
  };

  const updateExtractionStatus = async (id: string, newStatus: 'validated' | 'rejected' | 'pending') => {
    try {
      const docRef = doc(db, 'extractions', id);
      await updateDoc(docRef, { status: newStatus });
      setHistory(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
      
      // Log validation action
      if (user) {
        await addDoc(collection(db, 'activity_logs'), {
          userId: user.uid,
          accountId: (user as any).accountId,
          userDisplayName: user.displayName,
          action: `extraction_${newStatus}`,
          extractionId: id,
          timestamp: Timestamp.now()
        });
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      alert('Failed to update status. Check permissions.');
    }
  };

  const deleteExtraction = async (id: string) => {
    if (!confirm('Are you sure you want to delete this extraction record?')) return;
    try {
      await deleteDoc(doc(db, 'extractions', id));
      setHistory(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('Failed to delete extraction:', err);
      alert('Delete failed.');
    }
  };

  // History & Activity Listener
  useEffect(() => {
    if (!user) {
      setHistory([]);
      setActivityLogs([]);
      setAllUsers([]);
      return;
    }

    const isGuest = (user as any).role === 'guest';
    const isAdmin = (user as any).role === 'admin';
    const skipExtractions = isGuest || (isAdmin && !forceLoadHistory);

    let unsubHistory = () => {};
    if (!skipExtractions) {
      const historyQuery = isAdmin
        ? query(collection(db, 'extractions'), orderBy('createdAt', 'desc'), limit(100))
        : query(collection(db, 'extractions'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(50));
      
      unsubHistory = onSnapshot(historyQuery, (snapshot) => {
        const docs = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        })) as ExtractionResult[];
        setHistory(docs);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'extractions');
      });
    }

    let unsubActivity = () => {};
    let unsubUsers = () => {};
    let unsubAccounts = () => {};

    if (isAdmin && forceLoadHistory) {
      const activityQuery = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(50));
      unsubActivity = onSnapshot(activityQuery, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        })) as ActivityLog[];
        setActivityLogs(logs);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'activity_logs');
      });

      const usersQuery = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(50));
      unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        const users = snapshot.docs.map(doc => ({
          ...doc.data(),
          uid: doc.id
        })) as UserProfile[];
        setAllUsers(users);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'users');
      });

      const accountsQuery = query(collection(db, 'accounts'), orderBy('id', 'asc'));
      unsubAccounts = onSnapshot(accountsQuery, (snapshot) => {
        const accounts = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        })) as Account[];
        setAllAccounts(accounts);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'accounts');
      });
    }

    return () => {
      unsubHistory();
      unsubActivity();
      unsubUsers();
      unsubAccounts();
    };
  }, [user, forceLoadHistory]);

  // Update lastActive
  useEffect(() => {
    if (user && isAuthReady) {
      const updateLastActive = async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            lastActive: Timestamp.now()
          });
          if (user.accountId) {
            await updateDoc(doc(db, 'accounts', user.accountId), {
              lastActive: Timestamp.now()
            });
          }
        } catch (err) {
          // Ignore errors for lastActive updates to avoid spamming logs
        }
      };
      updateLastActive();
      const interval = setInterval(updateLastActive, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [user?.uid, user?.accountId, isAuthReady]);

  const toggleAccountStatus = async (targetAccount: Account) => {
    if (user?.role !== 'admin') return;
    const newStatus = !targetAccount.disabled;
    try {
      await updateDoc(doc(db, 'accounts', targetAccount.id), {
        disabled: newStatus
      });
      
      // Log the action
      await addDoc(collection(db, 'activity_logs'), {
        userId: user.uid,
        accountId: user.accountId,
        userDisplayName: user.displayName || 'Admin',
        action: newStatus ? 'account_disabled' : 'account_enabled',
        timestamp: Timestamp.now(),
        metadata: { targetAccountId: targetAccount.id }
      });

      // Track admin action
      ReactGA.event({
        category: 'Admin',
        action: newStatus ? 'Disable Account' : 'Enable Account',
        label: targetAccount.id
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `accounts/${targetAccount.id}`);
    }
  };

  const toggleUserStatus = async (targetUser: UserProfile) => {
    if (user?.role !== 'admin') return;
    const newStatus = !targetUser.disabled;
    try {
      await updateDoc(doc(db, 'users', targetUser.uid), {
        disabled: newStatus
      });
      
      // Log the action
      await addDoc(collection(db, 'activity_logs'), {
        userId: user.uid,
        accountId: user.accountId,
        userDisplayName: user.displayName || 'Admin',
        action: newStatus ? 'user_disabled' : 'user_enabled',
        timestamp: Timestamp.now(),
        metadata: { targetUserId: targetUser.uid, targetUserDisplayName: targetUser.displayName }
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
    }
  };

  // Enrichment with UniProt Target Metadata Helper (Memoized)
  const enrichResultsWithMetadata = useCallback(async (result: ExtractionResult) => {
    try {
      console.log(`[Enrichment] Initiating target metadata enrichment for patent: ${result.patentId}`);
      const uniqueTargets = Array.from(new Set(
        result.antibodies.flatMap(mAb => 
          mAb.chains.map(c => c.target).filter(Boolean) as string[]
        )
      ));

      if (uniqueTargets.length > 0) {
        console.log(`[Enrichment] Found unique targets: ${uniqueTargets.join(', ')}`);
        const metaResults = await Promise.all(
          uniqueTargets.map(async (t) => {
            try {
              const meta = await fetchTargetMetadata(t);
              return { target: t, metadata: meta };
            } catch (e) {
              console.warn(`[Enrichment] UniProt fetch failed for target: ${t}`, e);
              return { target: t, metadata: null };
            }
          })
        );

        const targetMap = new Map();
        metaResults.forEach(r => {
          if (r.metadata) {
            targetMap.set(r.target.toLowerCase().trim(), r.metadata);
          }
        });

        for (const mAb of result.antibodies) {
          // Find the most frequent primary target for this antibody
          const targetCounts: Record<string, number> = {};
          mAb.chains.forEach(c => {
            if (c.target) {
              const t = c.target.toLowerCase().trim();
              targetCounts[t] = (targetCounts[t] || 0) + 1;
            }
          });

          // Sort targets by frequency
          const sortedTargets = Object.entries(targetCounts).sort((a,b) => b[1] - a[1]);
          const topTarget = sortedTargets[0]?.[0];
          
          if (topTarget && targetMap.has(topTarget)) {
            mAb.targetMetadata = targetMap.get(topTarget);
            console.log(`[Enrichment] Successfully applied UniProt metadata for ${mAb.mAbName} (Target: ${topTarget}, UniProtId: ${mAb.targetMetadata?.uniprotId})`);
          } else if (topTarget) {
            console.log(`[Enrichment] No UniProt match found for top target "${topTarget}" of ${mAb.mAbName}`);
          }
        }
      } else {
        console.log(`[Enrichment] No targets found to enrich for patent: ${result.patentId}`);
      }
    } catch (enrichError) {
      console.error('[Enrichment] Critical failure in enrichment helper:', enrichError);
    }
    return result;
  }, []);

  const runExtraction = useCallback(async (file: File, overrideOptions?: LLMOptions) => {
    if (!file) return;
    const activeOptions = overrideOptions || llmOptions;
    console.log('Running extraction:', file.name, 'with range:', pageRange, 'Model:', activeOptions.model);

    setState(prev => ({ ...prev, isExtracting: true, extractingStatus: "Scanning for variable region patterns...", result: null, error: null }));
    
    try {
      const readFile = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve((event.target?.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
      };

      const fileData = await readFile(file);
      let listingData: string | undefined;
      let listingMimeType: string | undefined;

      if (sequenceListingFile) {
        listingData = await readFile(sequenceListingFile);
        listingMimeType = sequenceListingFile.type;
      }
      
      const startTime = Date.now();
      
      // Update status periodically
      const statusTimer = setTimeout(() => {
        setState(prev => ({ ...prev, extractingStatus: "Identifying CDR motifs..." }));
      }, 30000);

      const statusTimer2 = setTimeout(() => {
        setState(prev => ({ ...prev, extractingStatus: "Validating multiple antibody entries..." }));
      }, 60000);

      const result = await extractWithLLM(
        { data: fileData, mimeType: file.type }, 
        activeOptions, 
        pageRange,
        listingData ? { data: listingData, mimeType: listingMimeType! } : undefined,
        prioritySeqIds
      );

      clearTimeout(statusTimer);
      clearTimeout(statusTimer2);
      result.extractionTime = Date.now() - startTime;
      
      // Enrichment with UniProt Target Metadata
      await enrichResultsWithMetadata(result);

      setState(prev => ({ ...prev, isExtracting: false, result, error: null, extractingStatus: undefined }));
      setShowHistory(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSequenceListingFile(null);

      ReactGA.event({
        category: 'Extraction',
        action: 'File Upload',
        label: file.type,
        value: result.antibodies.length
      });

      if (user && user.role !== 'guest') {
        const { id: _id, ...resultData } = result as any;
        const docData = {
          ...resultData,
          userId: user.uid,
          userDisplayName: user.displayName || 'Anonymous Guest',
          userRole: user.role || 'guest',
          createdAt: Timestamp.now(),
          status: user.role === 'admin' ? 'validated' : 'pending',
          autoSaved: true
        };
        
        await addDoc(collection(db, 'activity_logs'), {
          userId: user.uid,
          accountId: user.accountId,
          userDisplayName: user.displayName || 'Anonymous Guest',
          action: 'extraction_completed',
          patentId: result.patentId,
          patentTitle: result.patentTitle,
          timestamp: Timestamp.now()
        });

        const docRef = await addDoc(collection(db, 'extractions'), docData);
        setState(prev => ({ 
          ...prev, 
          result: { ...result, id: docRef.id } 
        }));
      }
    } catch (err: any) {
      console.error('Final extraction error:', err);
      setState(prev => ({ ...prev, isExtracting: false, result: null, error: err.message || String(err) }));
    }
  }, [llmOptions, pageRange, sequenceListingFile, prioritySeqIds, user]);

  const runBatch = useCallback(async () => {
    if (!state.batch || state.batch.items.length === 0) return;
    
    setTimer(0);
    const batchStartTime = Date.now();
    setState(prev => ({
      ...prev,
      batch: { ...prev.batch!, isProcessing: true, currentIndex: 0, startTime: batchStartTime }
    }));

    const items = [...state.batch.items];
    const currentLlmOptions = { ...llmOptions };
    
    for (let i = 0; i < items.length; i++) {
       setState(prev => ({
         ...prev,
         isExtracting: true,
         result: null,
         batch: prev.batch ? { 
           ...prev.batch, 
           currentIndex: i, 
           items: prev.batch.items.map((item, idx) => idx === i ? { ...item, status: 'processing' } : item) 
         } : undefined
       }));

       const item = items[i];
       if (!item.file) continue;

       try {
         setState(prev => ({ ...prev, extractingStatus: "Scanning for variable region patterns..." }));
         const readFileData = (f: File): Promise<string> => {
           return new Promise((resolve, reject) => {
             const reader = new FileReader();
             reader.onload = (event) => resolve((event.target?.result as string).split(',')[1]);
             reader.onerror = reject;
             reader.readAsDataURL(f);
           });
         };

         const fileData = await readFileData(item.file);
         
         let listingData: string | undefined;
         let listingMimeType: string | undefined;
         if (sequenceListingFile) {
           listingData = await readFileData(sequenceListingFile);
           listingMimeType = sequenceListingFile.type;
         }

         const itemStartTime = Date.now();
         
         // Update status periodically for batch items too
         const statusTimer = setTimeout(() => {
           setState(prev => ({ ...prev, extractingStatus: "Identifying CDR motifs..." }));
         }, 30000);

         const statusTimer2 = setTimeout(() => {
           setState(prev => ({ ...prev, extractingStatus: "Validating multiple antibody entries..." }));
         }, 60000);

         const result = await extractWithLLM(
           { data: fileData, mimeType: item.file.type }, 
           currentLlmOptions, 
           pageRange, 
           listingData ? { data: listingData, mimeType: listingMimeType! } : undefined,
           prioritySeqIds
         );
         
         clearTimeout(statusTimer);
         clearTimeout(statusTimer2);
         const itemExtractionTime = Date.now() - itemStartTime;
         result.extractionTime = itemExtractionTime;

         // Enrichment for Batch Mode
         await enrichResultsWithMetadata(result);

         setState(prev => ({
           ...prev,
           result: result,
           batch: {
             ...prev.batch!,
             items: prev.batch!.items.map((it, idx) => idx === i ? { ...it, status: 'completed', result, extractionTime: itemExtractionTime } : it)
           }
         }));

         if (user && user.role !== 'guest') {
            const { id: _id, ...resultData } = result as any;
            await addDoc(collection(db, 'extractions'), {
              ...resultData,
              userId: user.uid,
              userDisplayName: user.displayName || 'Batch Processor',
              createdAt: Timestamp.now(),
              status: 'pending',
              batchId: 'batch_' + batchStartTime,
              autoSaved: true
            });
         }

       } catch (error: any) {
         console.error(`Batch item ${item.id} failed:`, error);
         setState(prev => ({
           ...prev,
           batch: {
             ...prev.batch!,
             items: prev.batch!.items.map((it, idx) => idx === i ? { ...it, status: 'error', error: error.message || String(error) } : it)
           }
         }));
       }

       // Cooldown period between patents
       if (i < items.length - 1) {
         const COOLDOWN_SECONDS = 2;
         for (let seconds = COOLDOWN_SECONDS; seconds > 0; seconds--) {
           setState(prev => ({
             ...prev,
             batch: { ...prev.batch!, cooldownRemaining: seconds }
           }));
           await new Promise(resolve => setTimeout(resolve, 1000));
         }
         setState(prev => ({
           ...prev,
           batch: { ...prev.batch!, cooldownRemaining: undefined }
         }));
       }
    }

    setState(prev => ({
      ...prev,
      isExtracting: false,
      batch: prev.batch ? { ...prev.batch, isProcessing: false, currentIndex: items.length, endTime: Date.now() } : undefined
    }));
  }, [llmOptions, user, state.batch?.items, pageRange, sequenceListingFile, prioritySeqIds, enrichResultsWithMetadata]);

  const handleBatchExportCsv = useCallback(async () => {
    if (!state.batch) return;
    
    setIsExporting(true);
    try {
      const allRows: any[] = [];
      const completedItems = state.batch.items.filter(i => i.status === 'completed' && i.result);
      
      completedItems.forEach(item => {
        const result = item.result!;
        result.antibodies.forEach(mAb => {
          const vhChain = mAb.chains.find(c => c.type === 'Heavy');
          const vlChain = mAb.chains.find(c => c.type === 'Light');
          
          allRows.push({
            mAbName: mAb.mAbName,
            patentId: result.patentId,
            patentTitle: result.patentTitle,
            target: vhChain?.target || vlChain?.target || '',
            targetStandardName: mAb.targetMetadata?.standardName || '',
            targetUniProtId: mAb.targetMetadata?.uniprotId || '',
            targetGeneSymbols: mAb.targetMetadata?.geneSymbols.join(', ') || '',
            targetSynonyms: mAb.targetMetadata?.synonyms.join(', ') || '',
            epitope: mAb.epitope || '',
            originSpecies: mAb.originSpecies || '',
            generationSource: mAb.generationSource || '',
            VH_SeqID: vhChain?.seqId || '',
            VH_FullSequence: vhChain?.fullSequence || '',
            VH_CDR1: vhChain?.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
            VH_CDR2: vhChain?.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
            VH_CDR3: vhChain?.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
            VL_SeqID: vlChain?.seqId || '',
            VL_FullSequence: vlChain?.fullSequence || '',
            VL_CDR1: vlChain?.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
            VL_CDR2: vlChain?.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
            VL_CDR3: vlChain?.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
            overallSeqID: mAb.seqId || '',
            confidence: mAb.confidence,
            needsReview: mAb.needsReview ? 'Yes' : 'No',
            reviewRemarks: mAb.reviewReason || '',
            characterization: mAb.experimentalData?.map(d => `[${d.category}] ${d.property}: ${d.value} ${d.unit} (${d.condition}) [${d.evidence}]`).join(' | ') || '',
            evidenceLocation: mAb.evidenceLocation || '',
            evidenceStatement: mAb.evidenceStatement || '',
            summary: mAb.summary
          });
        });
      });

      const csv = Papa.unparse(allRows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `abminer_batch_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
      setIsExporting(false);
    } catch (e) {
      setIsExporting(false);
      console.error(e);
    }
  }, [state.batch]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    
    if ('target' in e && (e.target as any).files) {
      file = (e.target as HTMLInputElement).files?.[0];
    } else if ('dataTransfer' in e && (e as any).dataTransfer.files) {
      file = (e as any).dataTransfer.files[0];
    }

    if (file) runExtraction(file);
  }, [runExtraction]);

  const handleReset = () => {
    setState(prev => ({ ...prev, isExtracting: false, result: null, error: null }));
    setPageRange('');
    setPrioritySeqIds('');
    setSequenceListingFile(null);
    setShowHistory(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const saveToFirestore = useCallback(async () => {
    if (!state.result || !user) return;
    
    if ((user as any)?.isGuest && !auth.currentUser) {
      setState(prev => ({ ...prev, error: 'Cannot save results in Guest Offline Mode. Please enable Anonymous Auth in Firebase Console.' }));
      return;
    }

    setIsSaving(true);
    try {
      // Strip any existing ID to avoid collisions
      const { id: _id, ...resultData } = state.result as any;
      const docData = {
        ...resultData,
        userId: user.uid,
        accountId: user.accountId,
        createdAt: Timestamp.now(),
        status: 'pending'
      };
      const docRef = await addDoc(collection(db, 'extractions'), docData);
      setState(prev => {
        if (prev.result) {
          return { ...prev, result: { ...prev.result, id: docRef.id } };
        }
        return prev;
      });
      setIsSaving(false);
    } catch (error) {
      setIsSaving(false);
      handleFirestoreError(error, OperationType.CREATE, 'extractions');
    }
  }, [state.result, user]);

  const handleExportCsv = useCallback(async () => {
    if (!state.result) return;
    
    setIsExporting(true);
    try {
      // Track download event
      ReactGA.event({
        category: 'Export',
        action: 'Download CSV',
        label: state.result.patentId
      });
      // Log download activity
      if (user) {
        addDoc(collection(db, 'activity_logs'), {
          userId: user.uid,
          accountId: user.accountId,
          userDisplayName: user.displayName || 'Anonymous Guest',
          action: 'download_csv',
          patentId: state.result.patentId,
          patentTitle: state.result.patentTitle,
          timestamp: Timestamp.now()
        }).catch(err => console.error('Failed to log activity:', err));
      }

      const rows: any[] = [];
      state.result.antibodies.forEach(mAb => {
        const vhChain = mAb.chains.find(c => c.type === 'Heavy');
        const vlChain = mAb.chains.find(c => c.type === 'Light');
        
        const row = {
          mAbName: mAb.mAbName,
          patentId: state.result?.patentId,
          patentTitle: state.result?.patentTitle,
          target: vhChain?.target || vlChain?.target || '',
          targetStandardName: mAb.targetMetadata?.standardName || '',
          targetUniProtId: mAb.targetMetadata?.uniprotId || '',
          targetGeneSymbols: mAb.targetMetadata?.geneSymbols.join(', ') || '',
          targetSynonyms: mAb.targetMetadata?.synonyms.join(', ') || '',
          epitope: mAb.epitope || '',
          originSpecies: mAb.originSpecies || '',
          generationSource: mAb.generationSource || '',
          
          // Heavy Chain (VH) Data
          VH_SeqID: vhChain?.seqId || '',
          VH_FullSequence: vhChain?.fullSequence || '',
          VH_CDR1: vhChain?.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
          VH_CDR2: vhChain?.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
          VH_CDR3: vhChain?.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
          
          // Light Chain (VL) Data
          VL_SeqID: vlChain?.seqId || '',
          VL_FullSequence: vlChain?.fullSequence || '',
          VL_CDR1: vlChain?.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
          VL_CDR2: vlChain?.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
          VL_CDR3: vlChain?.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
          
          overallSeqID: mAb.seqId || '',
          confidence: mAb.confidence,
          needsReview: mAb.needsReview ? 'Yes' : 'No',
          reviewRemarks: mAb.reviewReason || '',
          characterization: mAb.experimentalData?.map(d => `[${d.category}] ${d.property}: ${d.value} ${d.unit} (${d.condition}) [${d.evidence}]`).join(' | ') || '',
          evidenceLocation: mAb.evidenceLocation || '',
          evidenceStatement: mAb.evidenceStatement || '',
          summary: mAb.summary
        };
        rows.push(row);
      });

      const csv = Papa.unparse(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Sanitize filename
      const safeId = (state.result.patentId || 'result').replace(/[^a-z0-9]/gi, '_');
      link.setAttribute('download', `mAb-extraction-${safeId}.csv`);
      
      document.body.appendChild(link);
      link.click();
      
      // Small delay before cleanup to ensure trigger
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsExporting(false);
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 2000);
      }, 100);
    } catch (err) {
      console.error('Export error:', err);
      setIsExporting(false);
      setState(prev => ({ ...prev, error: 'Failed to export CSV. Try copying to clipboard instead.' }));
      
      // Fallback: Copy to clipboard if download fails
      try {
        const rows: any[] = [];
        state.result.antibodies.forEach(mAb => {
          const vhChain = mAb.chains.find(c => c.type === 'Heavy');
          const vlChain = mAb.chains.find(c => c.type === 'Light');
          rows.push({
            mAbName: mAb.mAbName,
            target: vhChain?.target || vlChain?.target || '',
            epitope: mAb.epitope || '',
            originSpecies: mAb.originSpecies || '',
            generationSource: mAb.generationSource || '',
            VH_SeqID: vhChain?.seqId || '',
            VL_SeqID: vlChain?.seqId || '',
            VH_Sequence: vhChain?.fullSequence || '',
            VL_Sequence: vlChain?.fullSequence || ''
          });
        });
        const csv = Papa.unparse(rows);
        await navigator.clipboard.writeText(csv);
        setState(prev => ({ ...prev, error: 'Download failed, but CSV data was copied to your clipboard!' }));
      } catch (clipErr) {
        console.error('Clipboard fallback failed:', clipErr);
      }
    }
  }, [state.result]);

  const handleCopyFasta = useCallback(() => {
    if (!state.result) return;
    
    const fasta = state.result.antibodies.flatMap(mAb => 
      mAb.chains.map(chain => 
        `>${mAb.mAbName} | ${chain.type} Chain | ${chain.target || 'N/A'} | ${state.result?.patentId}\n${chain.fullSequence}`
      )
    ).join('\n');
    
    navigator.clipboard.writeText(fasta);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [state.result]);

  const handleUpdateSequence = useCallback((mAbIdx: number, chainIdx: number, newSequence: string) => {
    if (!state.result) return;
    
    const newResult = { ...state.result };
    newResult.antibodies = [...newResult.antibodies];
    newResult.antibodies[mAbIdx] = { ...newResult.antibodies[mAbIdx] };
    newResult.antibodies[mAbIdx].chains = [...newResult.antibodies[mAbIdx].chains];
    newResult.antibodies[mAbIdx].chains[chainIdx] = { 
      ...newResult.antibodies[mAbIdx].chains[chainIdx],
      fullSequence: newSequence 
    };
    
    setState(prev => ({ ...prev, result: newResult }));
    
    // If it's a saved result, update Firestore
    if (newResult.id) {
      if ((user as any)?.isGuest && !auth.currentUser) {
        setState(prev => ({ ...prev, error: 'Cannot update saved results in Guest Offline Mode.' }));
        return;
      }
      updateDoc(doc(db, 'extractions', newResult.id), {
        antibodies: newResult.antibodies
      }).catch(error => handleFirestoreError(error, OperationType.UPDATE, `extractions/${newResult.id}`));
    }
  }, [state.result]);

  if (!user) {
    return (
      <div className="h-screen flex flex-col md:flex-row bg-white overflow-hidden">
        {/* Left Pane: Messaging & Atmosphere */}
        <div className="hidden md:flex md:w-[65%] bg-[#050505] relative overflow-hidden flex-col p-12 lg:p-16 justify-between">
          {/* Background Glows */}
          <div className="absolute top-[-15%] right-[-15%] w-[80%] h-[80%] bg-indigo-600/20 rounded-full blur-[140px]" />
          <div className="absolute bottom-[-15%] left-[-15%] w-[60%] h-[60%] bg-indigo-900/10 rounded-full blur-[120px]" />
          
          {/* Logo */}
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-lg">
              <AntibodyIcon className="text-zinc-900 w-5 h-5" />
            </div>
            <span className="text-white font-bold tracking-tight text-lg">AbMiner</span>
          </div>

          {/* Main Content */}
          <div className="relative z-10 max-w-4xl">
            <h1 className="text-6xl lg:text-7xl font-bold text-white leading-[0.9] mb-6 tracking-tighter">
              AbMiner<span className="text-indigo-500">.</span>
            </h1>
            
            <p className="text-zinc-300 text-xl font-light leading-relaxed mb-10 max-w-3xl">
              High-quality antibody sequence mining from complex patent landscapes. 
              Automated, validated, and analysis-ready.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10 mb-12">
              {[
                { label: 'Sequence Integrity', desc: 'Validated recovery of VH/VL chains from fragmented patent data.' },
                { label: 'Structural Mapping', desc: 'Precise identification of CDR regions using standardized numbering.' },
                { label: 'Full Provenance', desc: 'Direct traceability to source tables, SEQ IDs, and verbatim text.' },
                { label: 'Discovery Acceleration', desc: 'Accelerated identification of therapeutic candidates within complex patent landscapes.' }
              ].map((feature, i) => (
                <div key={i} className="group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3.5 bg-indigo-500/40 group-hover:bg-indigo-500 transition-colors" />
                    <span className="text-white font-bold text-xs uppercase tracking-widest">{feature.label}</span>
                  </div>
                  <p className="text-zinc-500 text-sm leading-relaxed font-light">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Info */}
          <div className="relative z-10 flex items-center gap-6 text-xs font-mono text-zinc-600 uppercase tracking-widest">
            <span>abminer.bio</span>
          </div>
        </div>

        {/* Right Pane: Login Form */}
        <div className="flex-1 flex flex-col p-8 md:p-12 lg:p-16 justify-center bg-white overflow-y-auto">
          <div className="max-w-sm w-full mx-auto">
            <div className="mb-10">
              <h2 className="text-3xl font-bold text-zinc-900 mb-2 tracking-tight">Sign In</h2>
              <p className="text-sm text-zinc-500">Access your research environment.</p>
            </div>

            <form onSubmit={handleGuestLogin} className="space-y-5 mb-10">
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none"
                  placeholder="Username"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 block">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all outline-none"
                  placeholder="••••••••"
                />
              </div>
              {loginError && <p className="text-xs text-red-600 font-medium">{loginError}</p>}
              <button
                type="submit"
                className="w-full bg-[#050505] text-white py-3.5 rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 active:scale-[0.98]"
              >
                Sign In
              </button>
            </form>

            <div className="relative mb-10">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-zinc-100"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-widest">
                <span className="bg-white px-4 text-zinc-300 font-bold">Waitlist</span>
              </div>
            </div>

            <form onSubmit={handleRequestAccess} className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 mb-1">Join the Waitlist</h3>
                <p className="text-xs text-zinc-500 leading-tight">Apply for early access to the AbMiner research platform.</p>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <input 
                  type="text" 
                  placeholder="Full Name" 
                  required
                  value={requestAccessForm.name}
                  onChange={(e) => setRequestAccessForm(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-colors" 
                />
                <input 
                  type="email" 
                  placeholder="Work Email" 
                  required
                  value={requestAccessForm.email}
                  onChange={(e) => setRequestAccessForm(prev => ({ ...prev, email: e.target.value }))}
                  className="bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-colors" 
                />
              </div>
              <textarea 
                placeholder="Briefly describe your research focus..." 
                required
                value={requestAccessForm.message}
                onChange={(e) => setRequestAccessForm(prev => ({ ...prev, message: e.target.value }))}
                className="w-full bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-2.5 text-xs outline-none focus:border-indigo-500 transition-colors h-24 resize-none"
              />
              <button 
                type="submit"
                disabled={requestStatus === 'sending'}
                className={cn(
                  "w-full py-3 rounded-xl font-bold text-xs transition-all border",
                  requestStatus === 'success' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                  requestStatus === 'error' ? "bg-red-50 text-red-700 border-red-100" :
                  "bg-amber-50 text-amber-800 border-amber-100 hover:bg-amber-100"
                )}
              >
                {requestStatus === 'sending' ? 'Sending Request...' : 
                 requestStatus === 'success' ? 'Request Submitted' :
                 requestStatus === 'error' ? 'Submission Failed' : 'Join Waitlist'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FA] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#050505] border-b border-white/10 px-8 py-4 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
            <AntibodyIcon className="text-zinc-900 w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">AbMiner</h1>
            <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">The Patent Antibody Mining Engine</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {(user as any)?.isGuest && !auth.currentUser && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-500 font-medium">
              <AlertCircle className="w-3 h-3" />
              Guest Offline Mode (Saving Disabled)
            </div>
          )}
          {user ? (
            <div className="flex items-center gap-4">
              {(user as any)?.role === 'admin' && (
                <button 
                  onClick={() => {
                    setShowAdminDashboard(!showAdminDashboard);
                    setShowHistory(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    showAdminDashboard ? "bg-amber-600 text-white" : "bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Database className="w-4 h-4" />
                  Admin Dashboard
                </button>
              )}
          {user && (user as any)?.role !== 'guest' && (
            <div className="flex items-center gap-4">
              { (user as any)?.role === 'admin' && !forceLoadHistory ? (
                <button 
                  onClick={() => setForceLoadHistory(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs font-bold text-indigo-400 hover:bg-indigo-500/20 transition-all uppercase tracking-widest"
                >
                  <RotateCcw className="w-4 h-4" />
                  Sync Database
                </button>
              ) : (
                <button 
                  onClick={() => {
                    setShowHistory(!showHistory);
                    setShowAdminDashboard(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                    showHistory ? "bg-indigo-600 text-white" : "bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <History className="w-4 h-4" />
                  { (user as any)?.role === 'admin' ? 'All History' : 'My History' } ({history.length})
                </button>
              )}
            </div>
          )}
              <div className="flex items-center gap-3 pl-4 border-l border-white/10">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-white">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-400">{user.email}</p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-white/10" />
                ) : (
                  <div className="w-8 h-8 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
                    <UserIcon className="w-4 h-4 text-zinc-500" />
                  </div>
                )}
                <button onClick={handleLogout} className="p-2 text-zinc-500 hover:text-red-500 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={signIn}
              className="flex items-center gap-2 bg-white text-zinc-900 px-6 py-2 rounded-xl font-medium text-sm hover:bg-zinc-100 transition-all"
            >
              <LogIn className="w-4 h-4" />
              Sign In to Save
            </button>
          )}
        </div>
      </header>

      {state.batch && (
        <div className="bg-zinc-900 text-white px-8 py-3 flex items-center justify-between border-b border-white/5 sticky top-0 z-[60] shadow-2xl backdrop-blur-md bg-zinc-900/95">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              {(state.batch.isProcessing || state.batch.cooldownRemaining) ? (
                <div className="relative">
                  <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-400 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Activity className="w-2.5 h-2.5 text-indigo-400 animate-pulse" />
                  </div>
                </div>
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              )}
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-none mb-1">
                  System Phase
                </span>
                <span className="text-[11px] font-bold text-white uppercase tracking-wider">
                  {state.batch.isProcessing ? 'Extraction Engine' : 'Batch Complete'}
                </span>
              </div>
            </div>
            
            <div className="h-6 w-px bg-white/10" />
            
            <div className="flex items-center gap-10">
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-none mb-1">
                  Status
                </span>
                <div className="text-[11px] font-medium min-w-[200px]">
                  {state.batch.cooldownRemaining ? (
                    <span className="text-amber-400 flex items-center gap-2 font-bold italic animate-pulse">
                      <Clock className="w-3 h-3" />
                      Cooling system: Resuming in {state.batch.cooldownRemaining}s...
                    </span>
                  ) : state.batch.isProcessing ? (
                    <div className="flex items-center gap-2">
                       <span className="text-indigo-400 font-black">Processing {state.batch.currentIndex + 1}/{state.batch.items.length}</span>
                       <span className="text-zinc-400 truncate max-w-[200px]">{state.batch.items[state.batch.currentIndex]?.id}</span>
                    </div>
                  ) : (
                    <span className="text-emerald-400 font-black">Consolidation Ready</span>
                  )}
                </div>
              </div>

               <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-none mb-1">
                  Elapsed Time
                </span>
                <div className="text-[11px] font-bold text-white font-mono tabular-nums">
                  {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
                </div>
              </div>

               <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 leading-none mb-1">
                  Total Progress
                </span>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(state.batch.items.filter(i => i.status === 'completed' || i.status === 'error').length / state.batch.items.length) * 100}%` }}
                      className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"
                    />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">
                    {Math.round((state.batch.items.filter(i => i.status === 'completed' || i.status === 'error').length / state.batch.items.length) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>


          <div className="flex items-center gap-4">
            {!state.batch.isProcessing && !state.batch.cooldownRemaining && (
               <>
                 <button 
                   onClick={handleBatchExportCsv}
                   className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                 >
                   <Download className="w-3.5 h-3.5" />
                   DOWNLOAD MASTER CSV
                 </button>
                 <button 
                   onClick={() => setState(prev => ({ ...prev, batch: undefined }))}
                   className="p-2 text-zinc-500 hover:text-white transition-colors"
                   title="Exit Batch Mode"
                 >
                   <X className="w-5 h-5" />
                 </button>
               </>
            )}
            {state.batch.isProcessing && (
              <span className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] animate-pulse uppercase">Sequence Extraction in Progress</span>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input */}
        <div className="lg:col-span-4 space-y-6">
          {/* System Health Dashboard */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[10px] uppercase font-bold text-zinc-400 tracking-widest flex items-center gap-2">
                <Activity className="w-3 h-3 text-indigo-500" />
                System Infrastructure
              </h3>
              <div className="flex items-center gap-1.5">
                <div className={cn("w-1.5 h-1.5 rounded-full", networkStats.online ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                <span className="text-[9px] font-bold text-zinc-500 uppercase">{networkStats.online ? 'Live' : 'Offline'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-3 rounded-xl border border-zinc-100 shadow-sm">
                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter mb-1">API Latency</p>
                <div className="flex items-end gap-1">
                  <span className="text-sm font-bold text-zinc-700">{networkStats.latency === -1 ? '--' : networkStats.latency}</span>
                  <span className="text-[8px] text-zinc-400 mb-0.5">ms</span>
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-zinc-100 shadow-sm">
                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter mb-1">Engine Health</p>
                <span className={cn(
                  "text-[10px] font-bold uppercase",
                  healthInfo?.status === 'ok' ? "text-emerald-600" : "text-amber-600"
                )}>
                  {healthInfo ? (healthInfo.concurrency?.activeCount > 0 ? 'Busy' : 'Optimal') : 'Checking...'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[9px]">
                <span className="text-zinc-400 uppercase font-medium">Model Load / Concurrency</span>
                <span className="text-zinc-600 font-bold uppercase tracking-tighter">
                  {healthInfo ? `${healthInfo.concurrency?.activeCount || 0} Active / ${healthInfo.concurrency?.pendingCount || 0} Queued` : '--'}
                </span>
              </div>
              <div className="w-full h-1 bg-zinc-200 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: healthInfo ? `${Math.min(100, ((healthInfo.concurrency?.activeCount + healthInfo.concurrency?.pendingCount) / 4) * 100)}%` : '0%' }}
                  className={cn(
                    "h-full transition-all duration-500",
                    (healthInfo?.concurrency?.activeCount || 0) >= 2 ? "bg-amber-500" : "bg-indigo-500"
                  )} 
                />
              </div>
              <p className="text-[8px] text-zinc-400 font-mono tracking-tight leading-tight">
                {healthInfo ? `Throughput: 100% | Latency: ${networkStats.latency}ms | Load: ${healthInfo.concurrency?.activeCount > 0 ? 'Elevated' : 'Stable'}` : 'Synchronizing system metrics...'}
              </p>
            </div>

            <div className="pt-2 border-t border-zinc-200 flex items-center justify-between">
              <span className="text-[8px] text-zinc-400 italic">Last ping: {networkStats.lastChecked.toLocaleTimeString()}</span>
              <button onClick={checkHealth} className="text-[8px] font-bold text-indigo-600 hover:underline uppercase tracking-widest">Verify Nodes</button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-indigo-600" />
                <h2 className="font-semibold text-zinc-800">
                  {(user as any)?.role === 'guest' ? 'AI Analysis Engine' : 'Model Benchmarking'}
                </h2>
              </div>
              {(user as any)?.role === 'guest' && (
                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-tight">
                  Active
                </span>
              )}
            </div>
            
            <div className="space-y-6">
              <div className="grid grid-cols-4 gap-2">
                {(['gemini', 'openai', 'anthropic', 'gemma'] as any[]).map(p => {
                  const isDisabled = user?.role === 'guest' && p !== 'gemini' && p !== 'gemma';
                  const displayLabel = p === 'gemini' ? 'Gemini' : p === 'gemma' ? 'Gemma' : p === 'openai' ? 'OpenAI' : 'Anthropic';
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => setLlmOptions(prev => ({ 
                        ...prev, 
                        provider: p, 
                        model: p === 'gemini' ? 'gemini-3.1-pro-preview' : p === 'openai' ? 'gpt-4o' : p === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gemma-4' 
                      }))}
                      className={cn(
                        "py-2 px-1 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border",
                        llmOptions.provider === p
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100" 
                          : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100",
                        isDisabled && "opacity-40 grayscale cursor-not-allowed"
                      )}
                    >
                      {displayLabel}
                    </button>
                  );
                })}
              </div>
              <select
                value={llmOptions.model}
                onChange={(e) => setLlmOptions({ ...llmOptions, model: e.target.value })}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50"
              >
                {llmOptions.provider === 'gemini' && (
                  <>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Reasoning)</option>
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                    <option value="gemini-2.5-flash-preview" disabled={(user as any)?.role === 'guest'}>Gemini 2.5 Flash</option>
                  </>
                )}
                {llmOptions.provider === 'gemma' && (
                  <>
                    <option value="gemma-4">Gemma 4 (High Thinking / Open Weights)</option>
                  </>
                )}
                {llmOptions.provider === 'openai' && (
                  <>
                    <option value="gpt-4o">GPT-4o (Omni)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="o1-preview">o1 Preview (Reasoning)</option>
                  </>
                )}
                {llmOptions.provider === 'anthropic' && (
                  <>
                    <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet</option>
                    <option value="claude-3-5-haiku-latest">Claude 3.5 Haiku</option>
                    <option value="claude-3-opus-latest">Claude 3 Opus</option>
                  </>
                )}
              </select>

              <div className="flex items-center justify-between mt-2 pt-4 border-t border-zinc-100">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-700">SAR Data Extraction</span>
                    {llmOptions.model !== 'gemma-4' && (
                      <span className="text-[8px] bg-zinc-100 text-zinc-400 px-1 py-0.5 rounded uppercase font-bold tracking-tighter">Gemma 4 Only</span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-400 leading-tight">Extract IC50, PK, ADMET & In Vivo evidence</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLlmOptions(prev => ({ ...prev, isSarMode: !prev.isSarMode }))}
                  disabled={llmOptions.model !== 'gemma-4'}
                  className={cn(
                    "relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                    llmOptions.isSarMode ? "bg-indigo-600" : "bg-zinc-200",
                    llmOptions.model !== 'gemma-4' && "opacity-30 cursor-not-allowed grayscale"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      llmOptions.isSarMode ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm sticky top-24">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-indigo-600" />
                <h2 className="font-semibold text-zinc-800">
                  {mode === 'single' ? 'Input Patent Data' : 'Batch Patent Processing'}
                </h2>
              </div>
              <div className="flex bg-zinc-100 p-0.5 rounded-lg">
                <button
                  onClick={() => setMode('single')}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                    mode === 'single' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  SINGLE
                </button>
                <button
                  onClick={() => setMode('batch')}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                    mode === 'batch' ? "bg-white text-indigo-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  BATCH
                </button>
              </div>
            </div>

            <div className="space-y-5">
              {mode === 'single' ? (
                <>
                  {/* Single Mode UI */}
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Page Context</span>
                        <span className="text-[9px] text-zinc-400 font-medium italic">e.g. "Table 1"</span>
                      </label>
                      <input
                        type="text"
                        value={pageRange}
                        onChange={(e) => setPageRange(e.target.value)}
                        placeholder="Optional target range..."
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                        disabled={state.isExtracting}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Priority IDs</span>
                        <span className="text-[9px] text-zinc-400 font-medium italic">e.g. "7, mab1"</span>
                      </label>
                      <input
                        type="text"
                        value={prioritySeqIds}
                        onChange={(e) => setPrioritySeqIds(e.target.value)}
                        placeholder="List priority IDs or names..."
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                        disabled={state.isExtracting}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sequence Listing File</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-zinc-300 font-medium italic">.txt, .xml</span>
                        {sequenceListingFile && (
                          <button 
                            onClick={() => setSequenceListingFile(null)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </label>
                    <div className="relative">
                      <input
                        type="file"
                        accept=".txt,.xml"
                        onChange={(e) => setSequenceListingFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        disabled={state.isExtracting}
                      />
                      <div className={cn(
                        "border border-zinc-200 rounded-xl px-4 py-2 text-xs flex items-center gap-3 transition-all",
                        sequenceListingFile ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-zinc-50 text-zinc-500 hover:border-indigo-300"
                      )}>
                        <FileText className={cn("w-4 h-4", sequenceListingFile ? "text-indigo-600" : "text-zinc-400")} />
                        <span className="truncate flex-1">
                          {sequenceListingFile ? sequenceListingFile.name : "Select Sequence Listing File..."}
                        </span>
                        {sequenceListingFile && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                      </div>
                    </div>
                  </div>

                  <div 
                    className="relative group"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleFileUpload(e as any);
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      disabled={state.isExtracting}
                    />
                    <div className={cn(
                      "border-2 border-dashed border-zinc-200 rounded-xl p-8 text-center transition-all group-hover:border-indigo-400 group-hover:bg-indigo-50/30",
                      state.isExtracting && "opacity-50 pointer-events-none"
                    )}>
                      {state.isExtracting ? (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
                          <p className="text-sm font-medium text-indigo-600">Extracting Sequences...</p>
                          <p className="text-[10px] text-indigo-400 mt-1 uppercase tracking-widest font-mono">Analyzing Document Structure</p>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-zinc-400 mx-auto mb-3 group-hover:text-indigo-500 transition-colors" />
                          <p className="text-sm font-medium text-zinc-700">Upload Patent Document</p>
                          <p className="text-xs text-zinc-500 mt-1">PDF or TXT files supported</p>
                        </>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-6">
                  {/* Batch Mode UI */}
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-4 h-4 text-indigo-600" />
                      <p className="text-[11px] font-bold text-indigo-900 uppercase">Batch Processing Rules</p>
                    </div>
                    <ul className="text-[10px] text-indigo-700 space-y-1.5 list-disc pl-4 leading-relaxed">
                      <li>Max 20 patents per batch.</li>
                      <li>Extractions run sequentially to guarantee accuracy.</li>
                      <li>Failed extractions are automatically skipped.</li>
                      <li>Consolidated CSV generated upon completion.</li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                      Queue Patents (Upload Files)
                    </label>
                    <div className="relative group">
                      <input
                        type="file"
                        accept=".pdf,.txt"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []) as File[];
                          if (files.length > 20) {
                            alert("Maximum 20 patents allowed per batch.");
                            return;
                          }
                          const newItems = files.map(f => ({
                            id: f.name,
                            file: f,
                            status: 'pending' as const,
                          }));
                          setState(prev => ({
                            ...prev,
                            batch: {
                              isProcessing: false,
                              items: newItems,
                              currentIndex: -1
                            }
                          }));
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        disabled={state.batch?.isProcessing}
                      />
                      <div className={cn(
                        "border-2 border-dashed border-zinc-200 rounded-xl p-6 text-center transition-all group-hover:border-indigo-400 group-hover:bg-indigo-50/30",
                        state.batch?.isProcessing && "opacity-50 pointer-events-none"
                      )}>
                        <Upload className="w-6 h-6 text-zinc-400 mx-auto mb-2 group-hover:text-indigo-500 transition-colors" />
                        <p className="text-xs font-medium text-zinc-700">Select Multiple PDF/TXT Files</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">Drag and drop or click to choose</p>
                      </div>
                    </div>
                  </div>

                  {state.batch && state.batch.items.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                        <div className="flex items-center gap-2">
                          <Database className="w-3.5 h-3.5 text-zinc-400" />
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                            Queue ({state.batch.items.length} Patents)
                          </p>
                        </div>
                        {state.batch.currentIndex === state.batch.items.length && (
                          <button
                            onClick={() => setState(prev => ({ ...prev, batch: { ...prev.batch!, items: [], currentIndex: -1, isProcessing: false } }))}
                            className="text-[9px] text-zinc-400 font-bold uppercase hover:text-red-500 transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Clear
                          </button>
                        )}
                      </div>
                      
                      <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 shadow-sm max-h-[400px] overflow-y-auto overflow-x-hidden custom-scrollbar">
                        {state.batch.items.map((item, idx) => (
                          <button 
                            key={idx} 
                            onClick={() => {
                              if (item.result) {
                                setState(prev => ({ ...prev, result: item.result }));
                              }
                            }}
                            disabled={!item.result}
                            className={cn(
                              "w-full px-4 py-3 flex items-center justify-between transition-colors text-left disabled:cursor-default",
                              (state.batch?.currentIndex === idx && item.status !== 'completed') ? "bg-indigo-50/50" : 
                              (state.result && item.result && state.result.patentId === item.result.patentId) ? "bg-indigo-100/50" : "hover:bg-zinc-50/50"
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                              <div className={cn(
                                "w-2 h-2 rounded-full shrink-0",
                                item.status === 'pending' ? "bg-zinc-200" :
                                (item.status === 'processing' || (state.batch?.isProcessing && state.batch.currentIndex === idx)) ? "bg-indigo-500 animate-pulse ring-4 ring-indigo-500/20" :
                                item.status === 'completed' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                              )} />
                              <div className="flex flex-col min-w-0">
                                <span className={cn(
                                  "text-[11px] truncate font-semibold",
                                  item.status === 'processing' ? "text-indigo-900" : "text-zinc-700"
                                )}>
                                  {item.id}
                                </span>
                                {item.extractionTime && (
                                  <span className="text-[9px] text-zinc-400 font-mono mt-0.5">
                                    {(item.extractionTime / 1000).toFixed(1)}s elapsed
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 flex items-center justify-end">
                              {item.status === 'pending' && <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-tighter">Waiting</span>}
                              {item.status === 'processing' && <span className="text-[10px] font-black text-indigo-600 uppercase italic animate-pulse">Live</span>}
                              {item.status === 'completed' && (
                                <div className="flex items-center gap-3">
                                  {item.result && (
                                    <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded leading-none">
                                      {item.result.antibodies.length} mAbs
                                    </span>
                                  )}
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                </div>
                              )}
                              {item.status === 'error' && (
                                <div className="flex items-center gap-2 group/err relative">
                                  <AlertCircle className="w-3.5 h-3.5 text-red-400 cursor-help" />
                                  <div className="absolute right-0 bottom-full mb-2 hidden group-hover/err:block w-48 p-2 bg-zinc-900 text-white text-[9px] rounded-lg shadow-xl z-20">
                                    {item.error || 'Unknown error'}
                                  </div>
                                  <span className="text-[9px] font-bold text-red-500 uppercase">Fail</span>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>

                        {(state.batch.currentIndex !== -1 && state.batch.currentIndex !== state.batch.items.length) ? (
                          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                  <Loader2 className={cn("w-4 h-4 text-indigo-400", state.batch.isProcessing && "animate-spin")} />
                                </div>
                                <div className="flex flex-col">
                                  <p className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">
                                    Queue Status
                                  </p>
                                  <p className="text-[9px] text-zinc-400">
                                    Phase {Math.max(0, (state.batch.currentIndex || 0) + 1)} of {state.batch.items.length}
                                  </p>
                                </div>
                              </div>
                              <p className="text-lg font-black text-indigo-600">
                                {Math.round(((Math.max(0, (state.batch.currentIndex || 0) + 1)) / state.batch.items.length) * 100)}%
                              </p>
                            </div>
                            <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden p-0.5">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${((Math.max(0, (state.batch.currentIndex || 0) + 1)) / state.batch.items.length) * 100}%` }}
                                className="bg-indigo-500 h-full rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(99,102,241,0.2)]"
                              />
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={runBatch}
                            className="w-full bg-indigo-600 text-white rounded-2xl py-4 font-bold text-sm shadow-xl shadow-indigo-100 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 active:scale-95"
                          >
                            <Beaker className="w-5 h-5" />
                            START BATCH ENGINE
                          </button>
                        )}
                      
                      {state.batch.items.some(i => i.status === 'completed') && (
                        <button
                          onClick={handleBatchExportCsv}
                          className="w-full bg-emerald-600 text-white rounded-xl py-2.5 text-xs font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 mt-2"
                        >
                          <Download className="w-4 h-4" />
                          EXPORT CONSOLIDATED CSV
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Global Error Overlays */}
          <AnimatePresence>
            {state.error && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-md">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="bg-white border border-zinc-200 rounded-[32px] p-10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] max-w-lg w-full relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-red-500" />
                  
                  <button 
                    onClick={() => setState(prev => ({ ...prev, error: null }))}
                    className="absolute top-6 right-6 p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-red-50 rounded-[28px] flex items-center justify-center mb-8">
                      <AlertCircle className="w-10 h-10 text-red-600" />
                    </div>
                    
                    <h2 className="text-2xl font-bold text-zinc-900 mb-3 tracking-tight">Extraction Failed</h2>
                    <p className="text-zinc-500 text-sm mb-10 leading-relaxed max-w-sm">
                      {formatErrorMessage(state.error)}
                    </p>

                    <div className="w-full flex flex-col gap-3">
                      <button
                        onClick={() => {
                          const file = fileInputRef.current?.files?.[0];
                          if (file) runExtraction(file);
                          else setState(prev => ({ ...prev, error: "No input found to retry. Please re-select your file." }));
                        }}
                        className="w-full bg-[#050505] text-white py-4 rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 flex items-center justify-center gap-3"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Retry Extraction
                      </button>

                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {/* Always show Mirror option for token limit errors */}
                        {(state.error.includes('token') || state.error.includes('262144')) ? (
                          <button
                            onClick={() => {
                              const proOptions = { ...llmOptions, provider: 'gemini' as const, model: 'gemini-1.5-pro' };
                              setLlmOptions(proOptions);
                              const file = fileInputRef.current?.files?.[0];
                              if (file) runExtraction(file, proOptions);
                              else setState(prev => ({ ...prev, error: "Switching to Pro... Please re-select your file to proceed." }));
                            }}
                            className="col-span-2 bg-indigo-600 text-white py-4 rounded-2xl font-bold text-sm hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-100"
                          >
                            <Coins className="w-4 h-4" />
                            Use Mirror (Gemini Pro - 2M Window)
                          </button>
                        ) : window.location.hostname.includes('.bio') && (
                          <button
                            onClick={() => window.location.href = 'https://abminer.up.railway.app'}
                            className="bg-zinc-100 text-zinc-700 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Use Mirror
                          </button>
                        )}
                        {(state.error.includes('503') || state.error.includes('429') || state.error.toLowerCase().includes('timeout')) && llmOptions.model !== 'gemini-3-flash-preview' && (
                          <button
                            onClick={() => {
                              setLlmOptions({ provider: 'gemini', model: 'gemini-3-flash-preview' });
                              setState(prev => ({ ...prev, error: null }));
                            }}
                            className={cn(
                              "bg-amber-100 text-amber-800 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-amber-200 transition-all flex items-center justify-center gap-2",
                              !window.location.hostname.includes('.bio') && "col-span-2"
                            )}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Switch to Flash
                          </button>
                        )}
                      </div>
                      
                      <button 
                        onClick={() => setState(prev => ({ ...prev, error: null }))}
                        className="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.2em] mt-2 hover:text-zinc-600 transition-colors"
                      >
                        Dismiss Error
                      </button>
                    </div>
                  </div>
                </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 space-y-8">
          {showAdminDashboard && (user as any)?.role === 'admin' ? (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Database className="w-6 h-6 text-amber-600" />
                    Admin Intelligence Dashboard
                  </h2>
                  <button 
                    onClick={() => {
                      // Instead of reload, just trigger a re-fetch by updating state or just relying on real-time listeners
                      // But since we want to "refresh", we can just clear local state if needed
                      // For now, let's just make it a no-op or a simple toast
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-zinc-100 text-zinc-600 rounded-lg text-xs font-medium hover:bg-zinc-200 transition-all"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Data is Real-time
                  </button>
                </div>
                <button onClick={() => setShowAdminDashboard(false)} className="text-sm text-zinc-500 hover:text-zinc-900">
                  Back to Analyzer
                </button>
              </div>

              {/* Debug Info for Admin */}
              <div className="bg-zinc-900 text-zinc-400 p-3 rounded-xl text-[10px] font-mono flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span>UID: {user.uid}</span>
                  <span>Role: {(user as any).role}</span>
                  <span>History Count: {history.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>System Live</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Extractions', value: history.length, icon: History, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Total Tokens', value: history.reduce((acc, curr) => acc + (curr.usageMetadata?.totalTokenCount || 0), 0).toLocaleString(), icon: Database, color: 'text-purple-600', bg: 'bg-purple-50' },
                  { label: 'Avg Extraction Time', value: `${(history.reduce((acc, curr) => acc + (curr.extractionTime || 0), 0) / (history.length || 1) / 1000).toFixed(1)}s`, icon: Loader2, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'Est. Total Cost', value: `$${(history.reduce((acc, curr) => {
                    const input = curr.usageMetadata?.promptTokenCount || 0;
                    const total = curr.usageMetadata?.totalTokenCount || 0;
                    const output = total - input;
                    const model = curr.modelUsed || 'gemini-3.1-pro-preview';
                    const rateKey = Object.keys(MODEL_RATES).find(k => model.includes(k)) || 'gemini-3.1-pro-preview';
                    const rates = (MODEL_RATES as any)[rateKey] || (MODEL_RATES as any)['gemini-3.1-pro-preview'];
                    return acc + (input / 1000000 * rates.input) + (output / 1000000 * rates.output);
                  }, 0)).toFixed(2)}`, icon: Save, color: 'text-emerald-600', bg: 'bg-emerald-50' }
                ].map((stat, i) => (
                  <div key={i} className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", stat.bg)}>
                      <stat.icon className={cn("w-5 h-5", stat.color)} />
                    </div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{stat.label}</p>
                    <p className="text-2xl font-bold text-zinc-900 mt-1">{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Recent Activity Table */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                  <h3 className="font-bold text-sm">System-wide Activity</h3>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Real-time Feed</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">User</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Patent</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">mAbs</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Tokens</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Time</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {history.slice(0, 50).map((item) => (
                        <tr key={item.id} className="hover:bg-zinc-50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-zinc-900">{(item as any).userDisplayName || (item.userId === user.uid ? 'You' : 'Guest')}</span>
                              <span className="text-[10px] text-zinc-400 font-mono">{(item as any).accountId || 'ID: ' + item.userId?.slice(0, 8)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold truncate max-w-[200px] text-zinc-900">{item.patentTitle}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[10px] text-zinc-500 font-mono">{item.patentId}</p>
                              {item.modelUsed && <span className="text-[9px] bg-zinc-100 text-zinc-500 px-1 rounded font-mono">{item.modelUsed}</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                             <div className="flex flex-col">
                               <span className="font-mono text-zinc-900">{item.antibodies.length} mAbs</span>
                               <span className="text-[10px] text-zinc-400 capitalize">{item.tier || 'standard'}</span>
                             </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-zinc-600 font-mono">{(item.usageMetadata?.totalTokenCount || 0).toLocaleString()}</span>
                               <span className="text-[10px] text-zinc-400">{getEstCost(item.usageMetadata, item.modelUsed || '')}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-zinc-900 font-mono">{((item.extractionTime || 0) / 1000).toFixed(1)}s</span>
                              <span className="text-[10px] text-zinc-400 font-mono">{item.createdAt ? new Date((item.createdAt as any).seconds * 1000).toLocaleDateString() : '-'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-2">
                               <div className="flex items-center gap-1">
                                <span className={cn(
                                  "text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                                  item.status === 'validated' ? "bg-emerald-100 text-emerald-700" :
                                  item.status === 'rejected' ? "bg-red-100 text-red-700" :
                                  "bg-amber-100 text-amber-700"
                                )}>
                                  {item.status}
                                </span>
                               </div>
                               <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => {
                                      setState(prev => ({ ...prev, result: item, isExtracting: false }));
                                      setShowAdminDashboard(false);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    title="View Result"
                                    className="p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all"
                                  >
                                    <Search className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => updateExtractionStatus(item.id!, 'validated')}
                                    title="Validate"
                                    className="p-1 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-all"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => updateExtractionStatus(item.id!, 'rejected')}
                                    title="Reject"
                                    className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => deleteExtraction(item.id!)}
                                    title="Delete"
                                    className="p-1 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded transition-all"
                                  >
                                    <X className="w-3.5 h-3.5 opacity-50" />
                                  </button>
                               </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Activity Logs Table */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                  <h3 className="font-bold text-sm">User Activity Logs</h3>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Audit Trail</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">User</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Action</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Target</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {activityLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-zinc-600">
                            {log.userDisplayName}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                              log.action === 'download_csv' ? "bg-blue-100 text-blue-700" :
                              log.action === 'extraction_completed' ? "bg-emerald-100 text-emerald-700" :
                              log.action === 'login' ? "bg-purple-100 text-purple-700" :
                              log.action === 'logout' ? "bg-zinc-100 text-zinc-700" :
                              log.action === 'user_disabled' ? "bg-red-100 text-red-700" :
                              log.action === 'user_enabled' ? "bg-emerald-100 text-emerald-700" :
                              "bg-zinc-100 text-zinc-700"
                            )}>
                              {log.action.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-zinc-500">
                            {log.patentId || log.metadata?.targetUserDisplayName || log.metadata?.role || '-'}
                          </td>
                          <td className="px-6 py-4 text-zinc-400 font-mono text-xs">
                            {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : '-'}
                          </td>
                        </tr>
                      ))}
                      {activityLogs.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-10 text-center text-zinc-400 italic">No activity logs recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Account Management Table */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                  <h3 className="font-bold text-sm">Account Management</h3>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">{allAccounts.length} Accounts</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Account</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Role</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Usage</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Last Active</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Status</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {allAccounts.map((acc) => {
                        const accountExtractions = history.filter(h => h.accountId === acc.id);
                        return (
                          <tr key={acc.id} className="hover:bg-zinc-50 transition-colors">
                            <td className="px-6 py-4">
                              <p className="font-bold">{acc.id}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                                acc.role === 'admin' ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-700"
                              )}>
                                {acc.role}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="font-bold text-zinc-700">{accountExtractions.length} runs</p>
                              <p className="text-[10px] text-zinc-400 font-mono">
                                {accountExtractions.reduce((acc, curr) => acc + (curr.usageMetadata?.totalTokenCount || 0), 0).toLocaleString()} tokens
                              </p>
                            </td>
                            <td className="px-6 py-4 text-zinc-500 text-xs font-mono">
                              {acc.lastActive ? new Date(acc.lastActive.seconds * 1000).toLocaleString() : 'Never'}
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "inline-flex items-center gap-1.5 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                                acc.disabled ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                              )}>
                                <span className={cn("w-1 h-1 rounded-full", acc.disabled ? "bg-red-500" : "bg-emerald-500")}></span>
                                {acc.disabled ? 'Disabled' : 'Active'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {acc.id !== user.accountId && (
                                <button
                                  onClick={() => toggleAccountStatus(acc)}
                                  className={cn(
                                    "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                                    acc.disabled ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100"
                                  )}
                                >
                                  {acc.disabled ? 'Enable Access' : 'Disable Access'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {allAccounts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-10 text-center text-zinc-400 italic">No accounts found. Log in once to initialize.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* User Sessions Table */}
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                  <h3 className="font-bold text-sm">Active Sessions (UIDs)</h3>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">{allUsers.length} Sessions</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100">
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Session UID</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Account</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider">Last Active</th>
                        <th className="px-6 py-3 font-bold text-zinc-400 uppercase text-[10px] tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {allUsers.map((u) => (
                        <tr key={u.uid} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-mono text-xs">{u.uid}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold text-zinc-600">{u.accountId || 'None'}</span>
                          </td>
                          <td className="px-6 py-4 text-zinc-500 text-xs font-mono">
                            {u.lastActive ? new Date(u.lastActive.seconds * 1000).toLocaleString() : 'Never'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {u.uid !== user.uid && (
                              <button
                                onClick={() => toggleUserStatus(u)}
                                className={cn(
                                  "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                                  u.disabled ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100"
                                )}
                              >
                                {u.disabled ? 'Enable Session' : 'Disable Session'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : showHistory ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <History className="w-6 h-6 text-indigo-600" />
                  Extraction History
                </h2>
                <button onClick={() => setShowHistory(false)} className="text-sm text-zinc-500 hover:text-zinc-900">
                  Back to Analyzer
                </button>
              </div>
              
              <div className="grid grid-cols-1 gap-4">
                {history.map((item) => (
                  <div key={item.id} className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm hover:border-indigo-300 transition-all group">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                            item.status === 'validated' ? "bg-emerald-100 text-emerald-700" :
                            item.status === 'rejected' ? "bg-red-100 text-red-700" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {item.status}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {item.createdAt ? new Date((item.createdAt as any).seconds * 1000).toLocaleDateString() : 'Unknown Date'}
                          </span>
                        </div>
                        <h3 className="font-bold text-lg">{item.patentTitle}</h3>
                        <p className="text-sm text-zinc-500 font-mono">{item.patentId}</p>
                        <p className="text-xs text-zinc-400 mt-2">{item.antibodies.length} mAbs Extracted</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setState(prev => ({ ...prev, isExtracting: false, result: item, error: null }))}
                          className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-medium hover:bg-zinc-200 transition-colors"
                        >
                          View Details
                        </button>
                        {user?.uid === item.userId && (
                          <button 
                            onClick={() => deleteExtraction(item.id!)}
                            className="p-2 text-zinc-300 hover:text-red-600 transition-colors"
                          >
                            <AlertCircle className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-center py-20 bg-white border border-zinc-200 border-dashed rounded-2xl">
                    <History className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
                    <p className="text-zinc-500">No history found.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {!state.result && (state.isExtracting || state.batch?.isProcessing) && (
                <div className="h-full min-h-[600px] flex flex-col items-center justify-center p-12 bg-white border border-zinc-200 rounded-3xl relative overflow-hidden">
                  <LoadingScreen 
                    status={state.extractingStatus} 
                    timer={timer} 
                    batchProgress={state.batch?.isProcessing ? {
                      current: state.batch.currentIndex + 1,
                      total: state.batch.items.length
                    } : undefined}
                  />
                </div>
              )}

              {!state.result && !state.isExtracting && !state.batch?.isProcessing && (
                <div className="h-full min-h-[600px] flex flex-col items-center justify-center text-center p-12 bg-white border border-zinc-200 border-dashed rounded-2xl">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900">No Data Extracted</h3>
                  <p className="text-sm text-zinc-500 max-w-xs mt-2">
                    Upload a patent document or paste sequence text to begin the AI extraction process.
                  </p>
                </div>
              )}

              {state.result && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-8"
                >
                  {/* Patent Summary Header */}
                  <div className="bg-zinc-900 text-white rounded-2xl p-6 shadow-xl">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-bold bg-indigo-500 text-white px-2 py-0.5 rounded uppercase tracking-wider inline-block">
                            Patent Source
                          </span>
                          {state.result.status && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                              state.result.status === 'validated' ? "bg-emerald-500 text-white" :
                              state.result.status === 'rejected' ? "bg-red-500 text-white" :
                              "bg-amber-500 text-white"
                            )}>
                              Status: {state.result.status}
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl font-bold">{state.result.patentTitle}</h2>
                        <div className="flex items-center gap-4 mt-1">
                          <p className="text-sm text-zinc-400 font-mono">{state.result.patentId}</p>
                          {state.result.extractionTime && (
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Time: {(state.result.extractionTime / 1000).toFixed(1)}s
                            </span>
                          )}
                          {state.result.usageMetadata && (
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-zinc-500 font-mono">
                                Total Tokens: {state.result.usageMetadata.totalTokenCount.toLocaleString()}
                              </span>
                              {state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount > state.result.usageMetadata.candidatesTokenCount && (
                                <span className="text-[10px] text-amber-500 font-mono">
                                  (incl. {(state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount - state.result.usageMetadata.candidatesTokenCount).toLocaleString()} thinking)
                                </span>
                              )}
                            </div>
                          )}
                          {state.result.modelUsed && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                              state.result.modelUsed.includes('flash') ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                            )}>
                              {state.result.modelUsed.replace('gemini-', '').replace('-preview', '')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {state.batch && state.batch.items.some(i => i.status === 'completed') && (
                          <div className="flex items-center bg-zinc-800 rounded-xl p-1 border border-white/5 mr-2">
                            <button
                              onClick={() => {
                                const currentIndex = state.batch!.items.findIndex(i => i.result && i.result.patentId === state.result?.patentId);
                                if (currentIndex > 0) {
                                  const prevItem = state.batch!.items.slice(0, currentIndex).reverse().find(i => i.status === 'completed');
                                  if (prevItem?.result) setState(prev => ({ ...prev, result: prevItem.result }));
                                }
                              }}
                              disabled={!state.batch.items.slice(0, state.batch.items.findIndex(i => i.result && i.result.patentId === state.result?.patentId)).some(i => i.status === 'completed')}
                              className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                              title="Previous Patent"
                            >
                              <ChevronRight className="w-4 h-4 rotate-180" />
                            </button>
                            <div className="h-4 w-px bg-white/10 mx-1" />
                            <button
                              onClick={() => {
                                const currentIndex = state.batch!.items.findIndex(i => i.result && i.result.patentId === state.result?.patentId);
                                if (currentIndex < state.batch!.items.length - 1) {
                                  const nextItem = state.batch!.items.slice(currentIndex + 1).find(i => i.status === 'completed');
                                  if (nextItem?.result) setState(prev => ({ ...prev, result: nextItem.result }));
                                }
                              }}
                              disabled={!state.batch.items.slice(state.batch.items.findIndex(i => i.result && i.result.patentId === state.result?.patentId) + 1).some(i => i.status === 'completed')}
                              className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                              title="Next Patent"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {user && !state.result.id && (
                          <button 
                            onClick={saveToFirestore}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Result
                          </button>
                        )}
                        <button 
                          onClick={handleReset}
                          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-xs font-medium transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Reset
                        </button>
                        {state.result.id && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => updateExtractionStatus(state.result!.id!, 'validated')}
                              className="px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-600/30 transition-all"
                            >
                              Validate
                            </button>
                            <button 
                              onClick={() => updateExtractionStatus(state.result!.id!, 'rejected')}
                              className="px-3 py-1.5 bg-red-600/20 text-red-400 border border-red-600/30 rounded-lg text-[10px] font-bold uppercase hover:bg-red-600/30 transition-all"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        <button 
                          onClick={handleCopyFasta}
                          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg border border-white/10 transition-colors relative group"
                          title="Copy All FASTA"
                        >
                          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-white" />}
                        </button>
                        <button 
                          onClick={handleExportCsv}
                          disabled={isExporting}
                          className={cn(
                            "p-2 rounded-lg border transition-all relative group",
                            exportSuccess ? "bg-emerald-600/20 border-emerald-600/30" : "bg-white/10 hover:bg-white/20 border-white/10"
                          )}
                          title="Export CSV"
                        >
                          {isExporting ? (
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                          ) : exportSuccess ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Table className="w-4 h-4 text-white" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <AntibodyIcon className="w-3 h-3 text-indigo-400" />
                          <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Total mAbs</span>
                        </div>
                        <span className="text-lg font-bold text-white">{state.result.antibodies.length}</span>
                      </div>

                      {state.result.extractionTime && (
                        <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Time Elapsed</span>
                          </div>
                          <span className="text-lg font-bold text-white">{(state.result.extractionTime / 1000).toFixed(1)}s</span>
                        </div>
                      )}

                      <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ArrowUpRight className="w-3 h-3 text-blue-400" />
                          <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Input Tokens</span>
                        </div>
                        <span className="text-lg font-bold text-white">
                          {state.result.usageMetadata ? state.result.usageMetadata.promptTokenCount.toLocaleString() : '---'}
                        </span>
                      </div>
                      
                      <div className="flex flex-col bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ArrowDownLeft className="w-3 h-3 text-emerald-400" />
                          <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Output Tokens</span>
                        </div>
                        <span className="text-lg font-bold text-white">
                          {state.result.usageMetadata ? 
                            (state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount).toLocaleString() 
                            : '---'}
                        </span>
                        {state.result.usageMetadata && (state.result.usageMetadata.thinkingTokenCount || (state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount > (state.result.usageMetadata.candidatesTokenCount || 0))) && (
                          <span className="text-[9px] text-amber-500/70 mt-1">
                            {state.result.usageMetadata.thinkingTokenCount 
                              ? `${state.result.usageMetadata.thinkingTokenCount.toLocaleString()} reasoning tokens`
                              : `${(state.result.usageMetadata.candidatesTokenCount || 0).toLocaleString()} response + ${(state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount - (state.result.usageMetadata.candidatesTokenCount || 0)).toLocaleString()} thinking`}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/20">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Coins className="w-3 h-3 text-indigo-400" />
                          <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Est. Cost (USD)</span>
                        </div>
                        <span className="text-lg font-bold text-indigo-100">
                          {getEstCost(state.result.usageMetadata, state.result.modelUsed || llmOptions.model)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Individual Antibody Results */}
                  <div className="space-y-12">
                    {state.result.antibodies.map((mAb, mAbIdx) => (
                      <div key={mAbIdx} className="space-y-4">
                        <div className="flex items-center gap-4">
                          <div className="h-px bg-zinc-200 flex-1" />
                          <div className="flex flex-col items-center gap-1">
                            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest px-4 py-1 bg-zinc-100 rounded-full border border-zinc-200">
                              {mAb.mAbName}
                            </h3>
                            <div className="flex items-center gap-2 flex-wrap justify-center">
                              {mAb.seqId && (
                                <span className="text-[9px] font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold border border-indigo-200 shadow-sm">
                                  {mAb.seqId}
                                </span>
                              )}
                              {mAb.pageNumber && (
                                <span className="text-[9px] font-mono bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded border border-zinc-200">
                                  Page {mAb.pageNumber}
                                </span>
                              )}
                              {mAb.tableId && (
                                <span className="text-[9px] font-mono bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded border border-zinc-200">
                                  {mAb.tableId}
                                </span>
                              )}
                              <div className="flex items-center gap-2">
                                <div className={cn(
                                  "w-2 h-2 rounded-full",
                                  mAb.confidence >= 95 ? "bg-emerald-500" :
                                  mAb.confidence >= 80 ? "bg-amber-500" :
                                  "bg-red-500"
                                )} />
                                <span className="text-[10px] font-bold text-zinc-500">{mAb.confidence}% Confidence</span>
                              </div>
                            </div>
                            {mAb.needsReview && (
                              <div className="flex items-center gap-1.5 px-3 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full text-[10px] font-bold uppercase animate-pulse">
                                <AlertCircle className="w-3 h-3" />
                                Needs Review
                              </div>
                            )}
                          </div>
                          <div className="h-px bg-zinc-200 flex-1" />
                        </div>
                        
                        {mAb.needsReview && mAb.reviewReason && (
                          <div className="bg-white border-2 border-red-500 rounded-xl p-4 text-xs text-red-700 flex items-start gap-3 shadow-sm">
                            <div className="bg-red-50 p-1.5 rounded-lg">
                              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                            </div>
                            <div>
                              <span className="font-black text-red-600 uppercase tracking-wider text-[10px] block mb-1">
                                Critical Extraction Alert
                              </span>
                              <div className="space-y-1 font-medium leading-relaxed">
                                {mAb.reviewReason.split(']').filter(Boolean).map((reason, i) => (
                                  <p key={i} className="flex items-center gap-2">
                                    <span className="w-1 h-1 rounded-full bg-red-400" />
                                    {reason.replace('[', '').trim()}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {mAb.targetMetadata ? (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-xs">
                            <div className="flex items-center gap-2 mb-2">
                              <Database className="w-4 h-4 text-indigo-600" />
                              <span className="font-bold text-indigo-900 uppercase tracking-wider text-[10px]">Target Info (UniProtKB)</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <span className="text-[10px] text-indigo-400 uppercase font-bold block mb-0.5">Standard Name</span>
                                <div className="font-bold text-zinc-900 flex items-center gap-2">
                                  {mAb.targetMetadata.standardName}
                                  <div className="flex items-center gap-1.5 ml-1">
                                    <span className="text-[9px] bg-indigo-100 text-indigo-700 font-mono px-1.5 py-0.5 rounded uppercase">
                                      {mAb.targetMetadata.uniprotId}
                                    </span>
                                    <a 
                                      href={`https://www.uniprot.org/uniprotkb/${mAb.targetMetadata.uniprotId}/entry`} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-indigo-400 hover:text-indigo-600 transition-colors"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] text-indigo-400 uppercase font-bold block mb-0.5">Gene Symbols</span>
                                <div className="text-zinc-600 font-mono">
                                  {mAb.targetMetadata.geneSymbols.join(', ')}
                                </div>
                              </div>
                              {mAb.targetMetadata.synonyms.length > 0 && (
                                <div className="col-span-full">
                                  <span className="text-[10px] text-indigo-400 uppercase font-bold block mb-0.5">Synonyms</span>
                                  <div className="text-zinc-500 leading-relaxed italic">
                                    {mAb.targetMetadata.synonyms.join(', ')}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : mAb.chains.some(c => c.target) && (
                          <div className="flex justify-start">
                            <button 
                              onClick={async () => {
                                const target = mAb.chains.find(c => c.target)?.target;
                                if (target) {
                                  const meta = await fetchTargetMetadata(target);
                                  if (meta) {
                                    setState(prev => {
                                      if (!prev.result) return prev;
                                      const newResult = { ...prev.result };
                                      newResult.antibodies[mAbIdx].targetMetadata = meta;
                                      return { ...prev, result: newResult };
                                    });
                                  }
                                }
                              }}
                              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-indigo-600 transition-all text-[10px] font-bold uppercase tracking-wider"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Fetch UniProt Metadata for {mAb.chains.find(c => c.target)?.target}
                            </button>
                          </div>
                        )}
                        
                        {/* Clonal Metadata (Epitope, Species, Source) */}
                        {(mAb.epitope || mAb.originSpecies || mAb.generationSource) && (
                          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-xs">
                             <div className="flex items-center gap-2 mb-3">
                              <Info className="w-4 h-4 text-zinc-400" />
                              <span className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">Clonal Metadata</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {mAb.epitope && (
                                <div>
                                  <span className="text-[10px] text-zinc-400 uppercase font-bold block mb-0.5">Epitope</span>
                                  <div className="font-medium text-zinc-900 leading-relaxed capitalize-first">
                                    {mAb.epitope}
                                  </div>
                                </div>
                              )}
                              {mAb.originSpecies && (
                                <div>
                                  <span className="text-[10px] text-zinc-400 uppercase font-bold block mb-0.5">Species of Origin</span>
                                  <div className="font-medium text-zinc-900 leading-relaxed">
                                    {mAb.originSpecies}
                                  </div>
                                </div>
                              )}
                              {mAb.generationSource && (
                                <div>
                                  <span className="text-[10px] text-zinc-400 uppercase font-bold block mb-0.5">Discovery Source</span>
                                  <div className="font-medium text-zinc-900 leading-relaxed">
                                    {mAb.generationSource}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="grid grid-cols-1 gap-6">
                          {mAb.chains.map((chain, chainIdx) => (
                            <SequenceDisplay 
                              key={chainIdx} 
                              chain={chain} 
                              isEditable={true}
                              onUpdate={(newSeq) => handleUpdateSequence(mAbIdx, chainIdx, newSeq)}
                            />
                          ))}
                        </div>
                        
                        <div className="bg-white border border-zinc-200 rounded-xl p-4 text-xs text-zinc-500 italic">
                          <span className="font-bold not-italic text-zinc-700 mr-2">AI Summary:</span>
                          {mAb.summary}
                        </div>

                        {mAb.experimentalData && mAb.experimentalData.length > 0 && (
                          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm mt-4">
                            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Beaker className="w-4 h-4 text-indigo-600" />
                                <h4 className="font-bold text-[10px] uppercase tracking-wider text-zinc-700">Experimental & Characterization Data</h4>
                              </div>
                              <span className="text-[10px] font-mono text-zinc-400 bg-white px-2 py-0.5 rounded border border-zinc-100">
                                Gemma 4 High-Fidelity Extraction
                              </span>
                            </div>
                            <div className="divide-y divide-zinc-200">
                              {['In Vitro', 'PK', 'ADMET', 'In Vivo', 'Physical', 'Other'].map(cat => {
                                const items = mAb.experimentalData!.filter(d => d.category === cat);
                                if (items.length === 0) return null;
                                return (
                                  <div key={cat} className="overflow-x-auto">
                                    <div className="px-4 py-2 bg-zinc-50/50 flex items-center gap-2 border-b border-zinc-100">
                                      <div className={cn(
                                        "w-1.5 h-1.5 rounded-full",
                                        cat === 'In Vitro' ? "bg-blue-500" :
                                        cat === 'PK' ? "bg-amber-500" :
                                        cat === 'ADMET' ? "bg-purple-500" :
                                        cat === 'In Vivo' ? "bg-red-500" :
                                        cat === 'Physical' ? "bg-emerald-500" :
                                        "bg-zinc-400"
                                      )} />
                                      <span className="text-[9px] font-bold uppercase tracking-tight text-zinc-500">{cat} Properties</span>
                                    </div>
                                    <table className="w-full text-left text-xs">
                                      <tbody className="divide-y divide-zinc-100">
                                        {items.map((data, idx) => (
                                          <tr key={idx} className="hover:bg-zinc-50/50 transition-colors">
                                            <td className="px-4 py-1.5 font-bold text-zinc-900 w-1/4">{data.property}</td>
                                            <td className="px-4 py-1.5 font-mono text-indigo-600 whitespace-nowrap w-1/4">{data.value} {data.unit}</td>
                                            <td className="px-4 py-1.5 text-zinc-600 leading-relaxed italic">{data.condition}</td>
                                            <td className="px-4 py-1.5 text-[10px] text-zinc-400 font-mono whitespace-nowrap text-right">{data.evidence}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {mAb.evidenceStatement && (
                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-700 flex items-start gap-3">
                            <div className="w-5 h-5 bg-indigo-100 rounded flex items-center justify-center shrink-0">
                              <Search className="w-3 h-3 text-indigo-600" />
                            </div>
                            <div>
                              <span className="font-bold text-indigo-900 mr-2 uppercase tracking-wider text-[10px]">Evidence Source:</span>
                              {mAb.evidenceStatement}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </main>

    {/* Footer */}
    <footer className="max-w-[1600px] w-full mx-auto px-8 py-8 border-t border-zinc-200 mt-auto flex flex-col md:flex-row items-center justify-between gap-6">
      <div className="flex items-center gap-2 text-zinc-400">
        <Database className="w-4 h-4" />
        <span className="text-xs font-mono">SECURE BIOTECH EXTRACTION ENGINE</span>
      </div>
      <div className="flex gap-8">
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-400 uppercase font-bold mb-1">Processing Mode</span>
          <span className="text-xs font-medium">Antibody Sequence Analysis</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-zinc-400 uppercase font-bold mb-1">Data Privacy</span>
          <span className="text-xs font-medium">Encrypted Session</span>
        </div>
      </div>
    </footer>
  </div>
);
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
