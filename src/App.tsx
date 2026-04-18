import React, { useState, useCallback, useEffect } from 'react';
import ReactGA from 'react-ga4';
import { FileText, Upload, Database, Download, AlertCircle, Loader2, ChevronRight, Search, FileUp, Copy, Check, LogIn, LogOut, History, Save, Table, User as UserIcon, RotateCcw, ExternalLink, X, Clock, Coins, ArrowUpRight, ArrowDownLeft, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, ExtractionResult, Antibody, UserProfile, ActivityLog, Account } from './types';
import { extractWithLLM, LLMProvider, LLMOptions } from './services/llm';
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
  });
  const [llmOptions, setLlmOptions] = useState<LLMOptions>({
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview'
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
    'gemini-3.1-pro-preview': { input: 3.5, output: 10.5 },
    'gemini-3-flash-preview': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash-preview': { input: 0.075, output: 0.30 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1-preview': { input: 15.0, output: 60.0 },
    'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-latest': { input: 0.25, output: 1.25 },
    'claude-3-opus-latest': { input: 15.0, output: 75.0 },
  };

  const getEstCost = (usage: any, modelUsed: string) => {
    if (!usage) return '---';
    const rates = (MODEL_RATES as any)[modelUsed] || (MODEL_RATES as any)['gemini-3.1-pro-preview'];
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
        await fetch('/api/health?ping=' + start, { method: 'HEAD', cache: 'no-store' });
        setNetworkStats(prev => ({ ...prev, latency: Date.now() - start, lastChecked: new Date() }));
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
            
            // Default guests to Pro
            if (profile.role === 'guest') {
              setLlmOptions({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
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
              setLlmOptions({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
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
        setState({ isExtracting: false, result: null, error: null });
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
    if (state.isExtracting) {
      setTimer(0);
      interval = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state.isExtracting]);

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
        
        // Default to Pro for guests
        if (role === 'guest') {
          setLlmOptions({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
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
      setState({ isExtracting: false, result: null, error: null });
      setPageRange('');
      setShowAdminDashboard(false);
      setShowHistory(false);
      setHistory([]);
      setActivityLogs([]);
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

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    
    if ('files' in e.target && (e.target as HTMLInputElement).files) {
      file = (e.target as HTMLInputElement).files?.[0];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      file = e.dataTransfer.files[0];
    }

    if (!file) return;
    console.log('File selected for extraction:', file.name, 'with page range:', pageRange);

    setState(prev => ({ ...prev, isExtracting: true, result: null, error: null }));
    
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
      
      try {
        const startTime = Date.now();
        const result = await extractWithLLM(
          { data: fileData, mimeType: file.type }, 
          llmOptions, 
          pageRange,
          listingData ? { data: listingData, mimeType: listingMimeType! } : undefined,
          prioritySeqIds
        );
        result.extractionTime = Date.now() - startTime;
        setState({ isExtracting: false, result, error: null });
        setShowHistory(false);

        // Clear file input so the same file can be uploaded again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setSequenceListingFile(null);

        // Track extraction event
        ReactGA.event({
          category: 'Extraction',
          action: 'File Upload',
          label: file!.type,
          value: result.antibodies.length
        });

        // Save extraction (disabled for admin and guests to save quota)
        if (user && user.role !== 'admin' && user.role !== 'guest') {
          // Strip any existing ID to avoid collisions
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
          
          // Log activity
          addDoc(collection(db, 'activity_logs'), {
            userId: user.uid,
            accountId: user.accountId,
            userDisplayName: user.displayName || 'Anonymous Guest',
            action: 'extraction_completed',
            patentId: result.patentId,
            patentTitle: result.patentTitle,
            timestamp: Timestamp.now()
          }).catch(err => {
            console.warn('Failed to log activity:', err);
          });

          addDoc(collection(db, 'extractions'), docData).then(docRef => {
            setState(prev => {
              if (prev.result && !prev.result.id) {
                return { ...prev, result: { ...prev.result, id: docRef.id } };
              }
              return prev;
            });
          }).catch(err => {
            console.warn('Failed to auto-save extraction:', err);
          });
        }
      } catch (err) {
        console.error('Extraction error:', err);
        setState({ isExtracting: false, result: null, error: err instanceof Error ? err.message : 'Extraction failed' });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (err) {
      console.error('File reading error:', err);
      setState({ isExtracting: false, result: null, error: 'Failed to read file' });
    }
  }, [pageRange, sequenceListingFile, llmOptions, user]);

  const handleReset = () => {
    setState({ isExtracting: false, result: null, error: null });
    setPageRange('');
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

  const updateStatus = useCallback(async (id: string, status: 'validated' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'extractions', id), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `extractions/${id}`);
    }
  }, []);

  const deleteExtraction = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'extractions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `extractions/${id}`);
    }
  }, []);

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
        mAb.chains.forEach(chain => {
          const row = {
            mAbName: mAb.mAbName,
            patentId: state.result?.patentId,
            patentTitle: state.result?.patentTitle,
            chainType: chain.type,
            target: chain.target || '',
            fullSequence: chain.fullSequence,
            CDR1: chain.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
            CDR2: chain.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
            CDR3: chain.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
            confidence: mAb.confidence,
            evidenceLocation: mAb.evidenceLocation || '',
            evidenceStatement: mAb.evidenceStatement || '',
            summary: mAb.summary
          };
          rows.push(row);
        });
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
          mAb.chains.forEach(chain => {
            rows.push({
              mAbName: mAb.mAbName,
              chainType: chain.type,
              target: chain.target || '',
              fullSequence: chain.fullSequence
            });
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
                <span className="text-[10px] font-bold text-emerald-600 uppercase">Optimal</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[9px]">
                <span className="text-zinc-400 uppercase font-medium">Model Load</span>
                <span className="text-zinc-600 font-bold uppercase tracking-tighter">Normal (0.4s)</span>
              </div>
              <div className="w-full h-1 bg-zinc-200 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '25%' }}
                  className="h-full bg-indigo-500" 
                />
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-200 flex items-center justify-between">
              <span className="text-[8px] text-zinc-400 italic">Last ping: {networkStats.lastChecked.toLocaleTimeString()}</span>
              <button onClick={checkHealth} className="text-[8px] font-bold text-indigo-600 hover:underline uppercase tracking-widest">Verify Nodes</button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
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
            
            {(user as any)?.role === 'guest' ? (
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-medium text-zinc-600">High-Quality Mining Engine (Pro)</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-2 leading-relaxed">
                  Using optimized sequence mining parameters for maximum verbatim accuracy and CDR identification.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {(['gemini', 'openai', 'anthropic'] as LLMProvider[]).map(p => {
                    const isDisabled = (user as any)?.role === 'guest' && p !== 'gemini';
                    return (
                      <button
                        key={p}
                        disabled={isDisabled}
                        onClick={() => setLlmOptions({ provider: p, model: p === 'gemini' ? 'gemini-3.1-pro-preview' : p === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-latest' })}
                        className={cn(
                          "py-2 px-1 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border",
                          llmOptions.provider === p 
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100" 
                            : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100",
                          isDisabled && "opacity-40 grayscale cursor-not-allowed"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <select
                  value={llmOptions.model}
                  onChange={(e) => setLlmOptions({ ...llmOptions, model: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50"
                  disabled={(user as any)?.role === 'guest'}
                >
                  {llmOptions.provider === 'gemini' && (
                    <>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (High Thinking)</option>
                      <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                      <option value="gemini-2.5-flash-preview" disabled={(user as any)?.role === 'guest'}>Gemini 2.5 Flash</option>
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
              </div>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm sticky top-24">
            <div className="flex items-center gap-2 mb-6">
              <FileUp className="w-5 h-5 text-indigo-600" />
              <h2 className="font-semibold text-zinc-800">Input Patent Data</h2>
            </div>

            <div className="space-y-6">
              {/* Page Range Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    Target Page / Range / Section (Optional)
                    <span className="font-normal lowercase text-zinc-300 italic">(e.g., "Page 42", "Pages 10-15", "Table 1")</span>
                  </div>
                </label>
                <input
                  type="text"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder="Focus on specific page, range, or table..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  disabled={state.isExtracting}
                />
              </div>

              {/* Priority SEQ IDs Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    Priority / Missing SEQ IDs (Optional)
                    <span className="font-normal lowercase text-zinc-300 italic">(e.g., "7, 12, 45")</span>
                  </div>
                </label>
                <input
                  type="text"
                  value={prioritySeqIds}
                  onChange={(e) => setPrioritySeqIds(e.target.value)}
                  placeholder="Tell AI which SEQ IDs to hunt for..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  disabled={state.isExtracting}
                />
              </div>

              {/* Sequence Listing File Upload */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    Sequence Listing File (Optional)
                    <span className="font-normal lowercase text-zinc-300 italic">(.txt, .xml)</span>
                  </div>
                  {sequenceListingFile && (
                    <button 
                      onClick={() => setSequenceListingFile(null)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
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
                          if (fileInputRef.current?.files?.[0]) handleFileUpload();
                          else setState(prev => ({ ...prev, error: "No input found to retry. Please re-select your file." }));
                        }}
                        className="w-full bg-[#050505] text-white py-4 rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 flex items-center justify-center gap-3"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Retry Extraction
                      </button>

                      <div className="grid grid-cols-2 gap-3 mt-2">
                        {window.location.hostname.includes('.bio') && (
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
                    const output = total - input; // Correctly includes thinking tokens
                    // Rough estimate: $3.50/1M input, $10.50/1M output
                    return acc + (input * 0.0000035) + (output * 0.0000105);
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
                      {history.slice(0, 10).map((item) => (
                        <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-zinc-600">
                            {item.userId === user.uid ? 'You (Admin)' : 'Guest User'}
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-bold truncate max-w-[200px]">{item.patentTitle}</p>
                            <p className="text-[10px] text-zinc-400 font-mono">{item.patentId}</p>
                          </td>
                          <td className="px-6 py-4 text-zinc-500 font-mono">{item.antibodies.length}</td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-zinc-600 font-mono">{(item.usageMetadata?.totalTokenCount || 0).toLocaleString()}</span>
                              {item.usageMetadata && (item.usageMetadata.totalTokenCount - item.usageMetadata.promptTokenCount > item.usageMetadata.candidatesTokenCount) && (
                                <span className="text-[9px] text-amber-500 font-mono">
                                  incl. {(item.usageMetadata.totalTokenCount - item.usageMetadata.promptTokenCount - item.usageMetadata.candidatesTokenCount).toLocaleString()} thinking
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-zinc-500 font-mono">{((item.extractionTime || 0) / 1000).toFixed(1)}s</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                              item.status === 'validated' ? "bg-emerald-100 text-emerald-700" :
                              item.status === 'rejected' ? "bg-red-100 text-red-700" :
                              "bg-amber-100 text-amber-700"
                            )}>
                              {item.status}
                            </span>
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
                          onClick={() => setState({ isExtracting: false, result: item, error: null })}
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
              {!state.result && !state.isExtracting && (
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

              {state.isExtracting && (
                <div className="h-full min-h-[600px] flex flex-col items-center justify-center text-center p-12 bg-white border border-zinc-200 rounded-2xl">
                  <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Database className="w-8 h-8 text-indigo-600" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900">Analyzing Patent Data</h3>
                  <div className="mt-2 mb-6">
                    <span className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-xl font-mono font-bold border border-indigo-100">
                      {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-mono text-zinc-400 animate-pulse">Scanning for variable region patterns...</p>
                    <p className="text-xs font-mono text-zinc-400 animate-pulse delay-75">Identifying CDR motifs...</p>
                    <p className="text-xs font-mono text-zinc-400 animate-pulse delay-150">Validating multiple antibody entries...</p>
                  </div>
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
                      <div className="flex gap-2">
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
                              onClick={() => updateStatus(state.result!.id!, 'validated')}
                              className="px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-600/30 transition-all"
                            >
                              Validate
                            </button>
                            <button 
                              onClick={() => updateStatus(state.result!.id!, 'rejected')}
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
                        {state.result.usageMetadata && (state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount > state.result.usageMetadata.candidatesTokenCount) && (
                          <span className="text-[9px] text-amber-500/70 mt-1">
                            {state.result.usageMetadata.candidatesTokenCount.toLocaleString()} response + {(state.result.usageMetadata.totalTokenCount - state.result.usageMetadata.promptTokenCount - state.result.usageMetadata.candidatesTokenCount).toLocaleString()} thinking
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
                          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-xs text-red-700 flex items-start gap-3">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                              <span className="font-bold block mb-1">Review Reason:</span>
                              {mAb.reviewReason}
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
            <span className="text-xs font-medium">Neural Sequence Analysis</span>
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
