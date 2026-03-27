import React, { useState, useCallback, useEffect } from 'react';
import { FileText, Upload, Database, Download, AlertCircle, Loader2, ChevronRight, Search, FileUp, Copy, Check, LogIn, LogOut, History, Save, Table, User as UserIcon, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, ExtractionResult, Antibody } from './types';
import { extractWithLLM, LLMProvider, LLMOptions } from './services/llm';
import { SequenceDisplay } from './components/SequenceDisplay';
import { auth, signIn, logout, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User, signInAnonymously, updateProfile } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, doc, updateDoc, deleteDoc, setDoc, getDocFromServer } from 'firebase/firestore';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  const [inputText, setInputText] = useState('');
  const [pageContext, setPageContext] = useState('');
  const [copied, setCopied] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [timer, setTimer] = useState(0);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // If it's a real Firebase user, we might need to fetch their role from Firestore
        // For anonymous users, we handle role in handleGuestLogin
        setUser(u);
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDocFromServer(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setUser(prev => prev ? { ...prev, ...userData } as any : null);
          } else {
            await setDoc(userRef, {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || 'Guest Curator',
              photoURL: u.photoURL || null,
              role: 'user'
            });
          }
        } catch (error) {
          console.error('Error fetching/creating user doc:', error);
        }
      } else {
        setUser(null);
        setState({ isExtracting: false, result: null, error: null });
        setInputText('');
        setPageContext('');
      }
    });
    return () => unsubscribe();
  }, []);

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
    const { username, password } = loginForm;
    
    const isGuestUser = ['guest', 'guest2', 'guest3'].includes(username) && password === 'Guest1@';
    const isAdminUser = username === 'Admin' && password === 'Admin1@';

    if (isGuestUser || isAdminUser) {
      try {
        const { user: anonUser } = await signInAnonymously(auth);
        const displayName = isAdminUser ? 'Admin' : `Guest Curator (${username})`;
        await updateProfile(anonUser, { displayName });
        
        const role = isAdminUser ? 'admin' : 'guest';
        
        // Update user document with role
        try {
          await setDoc(doc(db, 'users', anonUser.uid), {
            uid: anonUser.uid,
            displayName,
            role,
            isAnonymous: true
          });
        } catch (dbErr) {
          console.error('Error saving guest role to Firestore:', dbErr);
        }

        setUser({ ...anonUser, displayName, role } as any);
        setLoginError('');
        
        // Force Gemini 3.1 Pro for guests
        if (role === 'guest') {
          setLlmOptions({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
        }
      } catch (err: any) {
        console.error('Anonymous login failed:', err);
        const displayName = isAdminUser ? 'Admin' : `Guest Curator (${username})`;
        const mockUser: any = {
          uid: `mock-${username}`,
          displayName: `${displayName} (Offline Mode)`,
          email: `${username}@example.com`,
          isGuest: true,
          role: isAdminUser ? 'admin' : 'guest'
        };
        setUser(mockUser);
        setLoginError('');
        
        if (mockUser.role === 'guest') {
          setLlmOptions({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
        }
      }
    } else {
      setLoginError('Invalid credentials');
    }
  };

  const handleLogout = () => {
    setState({ isExtracting: false, result: null, error: null });
    setInputText('');
    setPageContext('');
    if ((user as any)?.isGuest) {
      setUser(null);
    } else {
      logout();
      setUser(null);
    }
  };

  // History Listener
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = (user as any)?.role === 'admin'
      ? query(collection(db, 'extractions'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'extractions'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ExtractionResult[];
      setHistory(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'extractions');
    });

    return () => unsubscribe();
  }, [user]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    
    if ('files' in e.target && (e.target as HTMLInputElement).files) {
      file = (e.target as HTMLInputElement).files?.[0];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      file = e.dataTransfer.files[0];
    }

    if (!file) return;
    console.log('File selected for extraction:', file.name, 'with page context:', pageContext);

    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const data = base64.split(',')[1];
        
        try {
          const startTime = Date.now();
          const result = await extractWithLLM({ data, mimeType: file!.type }, llmOptions, pageContext);
          result.extractionTime = Date.now() - startTime;
          setState({ isExtracting: false, result, error: null });
          setShowHistory(false);
        } catch (err) {
          console.error('Extraction error:', err);
          setState({ isExtracting: false, result: null, error: err instanceof Error ? err.message : 'Extraction failed' });
        }
      };
      reader.onerror = () => {
        setState({ isExtracting: false, result: null, error: 'Failed to read file' });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('File reading error:', err);
      setState({ isExtracting: false, result: null, error: 'Failed to initiate file reading' });
    }
  }, [pageContext]);

  const handleTextExtraction = useCallback(async () => {
    if (!inputText.trim()) return;
    
    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    try {
      const startTime = Date.now();
      const result = await extractWithLLM(inputText, llmOptions, pageContext);
      result.extractionTime = Date.now() - startTime;
      setState({ isExtracting: false, result, error: null });
      setShowHistory(false);
    } catch (err) {
      setState({ isExtracting: false, result: null, error: err instanceof Error ? err.message : 'Extraction failed' });
    }
  }, [inputText, pageContext]);

  const handleReset = () => {
    setState({ isExtracting: false, result: null, error: null });
    setInputText('');
    setPageContext('');
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
      const docData = {
        ...state.result,
        userId: user.uid,
        createdAt: Timestamp.now(),
        status: 'pending'
      };
      await addDoc(collection(db, 'extractions'), docData);
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
      const rows: any[] = [];
      state.result.antibodies.forEach(mAb => {
        mAb.chains.forEach(chain => {
          const row = {
            mAbName: mAb.mAbName,
            patentId: state.result?.patentId,
            patentTitle: state.result?.patentTitle,
            chainType: chain.type,
            fullSequence: chain.fullSequence,
            CDR1: chain.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
            CDR2: chain.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
            CDR3: chain.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
            confidence: mAb.confidence,
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
        `>${mAb.mAbName} | ${chain.type} Chain | ${state.result?.patentId}\n${chain.fullSequence}`
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
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-8">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl border border-zinc-200">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <Database className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">mAb Extractor</h1>
          </div>

          <form onSubmit={handleGuestLogin} className="space-y-4 mb-8">
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                placeholder="guest, guest2, guest3, or Admin"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                placeholder="••••••••"
              />
            </div>
            {loginError && <p className="text-xs text-red-600">{loginError}</p>}
            <button
              type="submit"
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium text-sm hover:bg-zinc-800 transition-colors"
            >
              Sign In
            </button>
          </form>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-zinc-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-zinc-400 font-mono">OR</span>
            </div>
          </div>

          <button 
            onClick={signIn}
            className="w-full flex items-center justify-center gap-3 bg-white border border-zinc-200 text-zinc-700 py-3 rounded-xl font-medium text-sm hover:bg-zinc-50 transition-all"
          >
            <LogIn className="w-4 h-4" />
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-200 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <Database className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">mAb Extractor</h1>
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Patent Intelligence Tool v1.0</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {(user as any)?.isGuest && !auth.currentUser && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 font-medium">
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
                    showAdminDashboard ? "bg-amber-600 text-white" : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  <Database className="w-4 h-4" />
                  Admin Dashboard
                </button>
              )}
              <button 
                onClick={() => {
                  setShowHistory(!showHistory);
                  setShowAdminDashboard(false);
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                  showHistory ? "bg-indigo-600 text-white" : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                )}
              >
                <History className="w-4 h-4" />
                { (user as any)?.role === 'admin' ? 'All History' : 'My History' } ({history.length})
              </button>
              <div className="flex items-center gap-3 pl-4 border-l border-zinc-200">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-zinc-900">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-500">{user.email}</p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-zinc-200" />
                ) : (
                  <div className="w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center border border-zinc-200">
                    <UserIcon className="w-4 h-4 text-zinc-400" />
                  </div>
                )}
                <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-red-600 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={signIn}
              className="flex items-center gap-2 bg-zinc-900 text-white px-6 py-2 rounded-xl font-medium text-sm hover:bg-zinc-800 transition-all"
            >
              <LogIn className="w-4 h-4" />
              Sign In to Save
            </button>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input */}
        <div className="lg:col-span-4 space-y-6">
          {/* Model Selection */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-indigo-600" />
                <h2 className="font-semibold text-zinc-800">Model Benchmarking</h2>
              </div>
              {(user as any)?.role === 'guest' && (
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 uppercase tracking-tight">
                  Restricted Access
                </span>
              )}
            </div>
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
                    <option value="gemini-3-flash-preview" disabled={(user as any)?.role === 'guest'}>Gemini 3 Flash (Fast)</option>
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
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm sticky top-24">
            <div className="flex items-center gap-2 mb-6">
              <FileUp className="w-5 h-5 text-indigo-600" />
              <h2 className="font-semibold text-zinc-800">Input Patent Data</h2>
            </div>

            <div className="space-y-6">
              {/* Page Context Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  Target Page / Range / Section (Optional)
                  <span className="font-normal lowercase text-zinc-300 italic">(e.g., "Page 42", "Pages 10-15", "Table 1")</span>
                </label>
                <input
                  type="text"
                  value={pageContext}
                  onChange={(e) => setPageContext(e.target.value)}
                  placeholder="Focus on specific page, range, or table..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  disabled={state.isExtracting}
                />
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

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-zinc-200"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-zinc-400 font-mono">OR PASTE TEXT</span>
                </div>
              </div>

              {/* Text Input */}
              <div className="space-y-3">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Paste patent description or sequence listing text here..."
                  className="w-full h-48 bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
                  disabled={state.isExtracting}
                />
                <button
                  onClick={handleTextExtraction}
                  disabled={state.isExtracting || !inputText.trim()}
                  className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {state.isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Analyze Text
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Status/Error */}
          <AnimatePresence>
            {state.error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900">Extraction Error</p>
                  <p className="text-xs text-red-700 mt-1">{state.error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 space-y-8">
          {showAdminDashboard && (user as any)?.role === 'admin' ? (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Database className="w-6 h-6 text-amber-600" />
                  Admin Intelligence Dashboard
                </h2>
                <button onClick={() => setShowAdminDashboard(false)} className="text-sm text-zinc-500 hover:text-zinc-900">
                  Back to Analyzer
                </button>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Extractions', value: history.length, icon: History, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Total Tokens', value: history.reduce((acc, curr) => acc + (curr.usageMetadata?.totalTokenCount || 0), 0).toLocaleString(), icon: Database, color: 'text-purple-600', bg: 'bg-purple-50' },
                  { label: 'Avg Extraction Time', value: `${(history.reduce((acc, curr) => acc + (curr.extractionTime || 0), 0) / (history.length || 1) / 1000).toFixed(1)}s`, icon: Loader2, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'Est. Total Cost', value: `$${(history.reduce((acc, curr) => {
                    const input = curr.usageMetadata?.promptTokenCount || 0;
                    const output = curr.usageMetadata?.candidatesTokenCount || 0;
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
                          <td className="px-6 py-4 text-zinc-500 font-mono">{(item.usageMetadata?.totalTokenCount || 0).toLocaleString()}</td>
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
                          {state.result.id && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                              state.result.status === 'validated' ? "bg-emerald-500" :
                              state.result.status === 'rejected' ? "bg-red-500" :
                              "bg-amber-500"
                            )}>
                              {state.result.status}
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
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Tokens: {state.result.usageMetadata.totalTokenCount}
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
                    <div className="mt-4 pt-4 border-t border-white/10 flex gap-6">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Total mAbs</span>
                        <span className="text-lg font-bold">{state.result.antibodies.length}</span>
                      </div>
                      {state.result.usageMetadata && (
                        <>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Tokens Used</span>
                            <span className="text-lg font-bold">
                              {state.result.usageMetadata.totalTokenCount.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Est. Cost (USD)</span>
                            <span className="text-lg font-bold text-emerald-400">
                              ${((state.result.usageMetadata.promptTokenCount / 1000000) * 1.25 + 
                                (state.result.usageMetadata.candidatesTokenCount / 1000000) * 5.00).toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
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
      <footer className="max-w-[1600px] mx-auto px-8 py-12 border-t border-zinc-200 mt-12 flex flex-col md:flex-row items-center justify-between gap-6">
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
