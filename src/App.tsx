import React, { useState, useCallback, useEffect } from 'react';
import { FileText, Upload, Database, Download, AlertCircle, Loader2, ChevronRight, Search, FileUp, Copy, Check, LogIn, LogOut, History, Save, Table, User as UserIcon, RotateCcw, X, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, ExtractionResult, Antibody } from './types';
import { extractSequences } from './services/gemini';
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
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [inputText, setInputText] = useState('');
  const [pageContext, setPageContext] = useState('');
  const [copied, setCopied] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Timer Effect
  useEffect(() => {
    if (state.isExtracting) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 100);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.isExtracting]);

  const calculateCost = (usage?: { promptTokenCount: number; candidatesTokenCount: number }) => {
    if (!usage) return 0;
    // Pricing for gemini-3.1-pro-preview: $1.25 / 1M input, $5.00 / 1M output
    const inputCost = (usage.promptTokenCount / 1000000) * 1.25;
    const outputCost = (usage.candidatesTokenCount / 1000000) * 5.00;
    return inputCost + outputCost;
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        // Create user document if it doesn't exist
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDocFromServer(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || 'Guest Curator',
              photoURL: u.photoURL || null,
              role: 'user'
            });
          }
        } catch (error) {
          // Ignore errors during user doc creation (might be permissions)
          console.error('Error creating user doc:', error);
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

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginForm.username === 'guest' && loginForm.password === 'Guest1@') {
      try {
        const { user: anonUser } = await signInAnonymously(auth);
        await updateProfile(anonUser, { displayName: 'Guest Curator' });
        setUser(anonUser);
        setLoginError('');
      } catch (err: any) {
        console.error('Anonymous login failed:', err);
        // Fallback to mock guest if Firebase Anonymous Auth is not enabled or restricted
        if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
          const mockGuest: any = {
            uid: 'guest-user',
            displayName: 'Guest Curator (Offline Mode)',
            email: 'guest@example.com',
            isGuest: true
          };
          setUser(mockGuest);
          setLoginError('');
          // We'll show a warning in the UI later
        } else {
          setLoginError(`Guest login failed: ${err.message || 'Unknown error'}`);
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

    const q = query(
      collection(db, 'extractions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

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

    const startTime = Date.now();
    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const data = base64.split(',')[1];
        
        try {
          const result = await extractSequences({ data, mimeType: file!.type }, pageContext);
          const endTime = Date.now();
          result.extractionTime = endTime - startTime;
          if (result.usageMetadata) {
            result.usageMetadata.cost = calculateCost(result.usageMetadata);
          }
          setDebugInfo(result.rawResponse || null);
          setState({ isExtracting: false, result, error: null });
          setShowHistory(false);
        } catch (err: any) {
          console.error('Extraction error:', err);
          setDebugInfo(err.rawResponse || null);
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
    
    const startTime = Date.now();
    setState(prev => ({ ...prev, isExtracting: true, error: null }));
    try {
      const result = await extractSequences(inputText, pageContext);
      const endTime = Date.now();
      result.extractionTime = endTime - startTime;
      if (result.usageMetadata) {
        result.usageMetadata.cost = calculateCost(result.usageMetadata);
      }
      setDebugInfo(result.rawResponse || null);
      setState({ isExtracting: false, result, error: null });
      setShowHistory(false);
    } catch (err: any) {
      console.error('Extraction error:', err);
      setDebugInfo(err.rawResponse || null);
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
        status: 'pending',
        extractionTime: state.result.extractionTime,
        usageMetadata: state.result.usageMetadata
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

  const handleExportCsv = useCallback((results?: any) => {
    const targetResults = Array.isArray(results) ? results : (state.result ? [state.result] : []);
    if (targetResults.length === 0) return;
    
    const rows: any[] = [];
    targetResults.forEach(res => {
      res.antibodies.forEach(mAb => {
        mAb.chains.forEach(chain => {
          const row = {
            mAbName: mAb.mAbName,
            patentId: res.patentId,
            patentTitle: res.patentTitle,
            chainType: chain.type,
            fullSequence: chain.fullSequence,
            CDR1: chain.cdrs.find(c => c.type === 'CDR1')?.sequence || '',
            CDR2: chain.cdrs.find(c => c.type === 'CDR2')?.sequence || '',
            CDR3: chain.cdrs.find(c => c.type === 'CDR3')?.sequence || '',
            confidence: mAb.confidence,
            summary: mAb.reasoning,
            extractionTimeMs: res.extractionTime || 0,
            costUsd: res.usageMetadata?.cost || 0
          };
          rows.push(row);
        });
      });
    });

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = targetResults.length === 1 
      ? `mAb-extraction-${targetResults[0].patentId || 'result'}.csv`
      : `mAb-bulk-export-${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [state.result]);

  const handleExportFasta = useCallback((results?: any) => {
    const targetResults = Array.isArray(results) ? results : (state.result ? [state.result] : []);
    if (targetResults.length === 0) return;
    
    const fasta = targetResults.flatMap(res => 
      res.antibodies.flatMap(mAb => 
        mAb.chains.map(chain => 
          `>${mAb.mAbName} | ${chain.type} Chain | ${res.patentId}\n${chain.fullSequence}`
        )
      )
    ).join('\n');
    
    const blob = new Blob([fasta], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = targetResults.length === 1 
      ? `mAb-extraction-${targetResults[0].patentId || 'result'}.fasta`
      : `mAb-bulk-export-${new Date().toISOString().split('T')[0]}.fasta`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                placeholder="guest"
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
              Sign In as Guest
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
            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Patent Intelligence Tool v2.1</p>
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
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                  showHistory ? "bg-indigo-600 text-white" : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                )}
              >
                <History className="w-4 h-4" />
                History ({history.length})
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
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-[10px] text-amber-700 leading-relaxed">
                      <span className="font-bold uppercase">Pro Tip:</span> For large patents (50+ pages), specifying a target page or table significantly improves extraction coverage and precision.
                    </p>
                    <p className="text-[10px] text-amber-700 leading-relaxed">
                      <span className="font-bold uppercase">Note:</span> Each extraction is limited to 30 sequences to ensure data integrity. If more exist, use the "Target Page / Range" to extract the next set.
                    </p>
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
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-900">Extraction Error</p>
                  <p className="text-xs text-red-700 mt-1">{state.error}</p>
                  {debugInfo && (
                    <button 
                      onClick={() => setShowDebug(true)}
                      className="mt-3 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:text-red-800 flex items-center gap-1"
                    >
                      <Terminal className="w-3 h-3" />
                      View Raw AI Response (Debug)
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Debug Modal */}
          <AnimatePresence>
            {showDebug && debugInfo && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden"
                >
                  <div className="p-6 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
                        <Terminal className="text-white w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-zinc-900">Raw AI Response</h3>
                        <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Troubleshooting Data</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(debugInfo);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs font-medium hover:bg-zinc-50 transition-all"
                      >
                        {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy to Clipboard'}
                      </button>
                      <button 
                        onClick={() => setShowDebug(false)}
                        className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-6 bg-zinc-900">
                    <pre className="text-[11px] font-mono text-emerald-400 whitespace-pre-wrap leading-relaxed">
                      {debugInfo}
                    </pre>
                  </div>
                  <div className="p-4 border-t border-zinc-200 bg-zinc-50 flex justify-between items-center">
                    <p className="text-[10px] text-zinc-500 italic">
                      This data is the raw output from the Gemini model before parsing.
                    </p>
                    <button 
                      onClick={() => setShowDebug(false)}
                      className="px-6 py-2 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-all"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8 space-y-8">
          {showHistory ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <History className="w-6 h-6 text-indigo-600" />
                  Extraction History
                </h2>
                <div className="flex gap-3">
                  {history.length > 0 && (
                    <>
                      <button 
                        onClick={async () => {
                          if (window.confirm('Are you sure you want to clear your entire history?')) {
                            for (const item of history) {
                              if (item.id) await deleteExtraction(item.id);
                            }
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600/10 text-red-600 rounded-xl text-sm font-medium hover:bg-red-600/20 transition-all"
                      >
                        <X className="w-4 h-4" />
                        Clear All
                      </button>
                      <button 
                        onClick={() => handleExportCsv(history)}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all"
                      >
                        <Download className="w-4 h-4" />
                        Bulk CSV
                      </button>
                      <button 
                        onClick={() => handleExportFasta(history)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-all"
                      >
                        <FileText className="w-4 h-4" />
                        Bulk FASTA
                      </button>
                    </>
                  )}
                  <button onClick={() => setShowHistory(false)} className="text-sm text-zinc-500 hover:text-zinc-900">
                    Back to Analyzer
                  </button>
                </div>
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
                  <div className="mt-4 text-center">
                    <p className="text-2xl font-mono font-bold text-indigo-600">
                      {formatTime(elapsedTime)}
                    </p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono mt-1">Elapsed Time</p>
                  </div>
                  <div className="mt-6 space-y-2">
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
                        <p className="text-sm text-zinc-400 mt-1 font-mono">{state.result.patentId}</p>
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
                          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg border border-white/10 transition-colors relative group"
                          title="Export CSV"
                        >
                          <Table className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-6">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Total mAbs</span>
                        <span className="text-lg font-bold">{state.result.antibodies.length}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Coverage Status</span>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-sm font-bold uppercase",
                            state.result.isExhaustive ? "text-emerald-400" : "text-amber-400"
                          )}>
                            {state.result.isExhaustive ? "Exhaustive" : "Partial"}
                          </span>
                          {!state.result.isExhaustive && (
                            <div className="flex items-center gap-2">
                              <div className="group relative">
                                <AlertCircle className="w-4 h-4 text-amber-400 cursor-help" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-zinc-800 text-white text-[10px] rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 leading-relaxed border border-white/10">
                                  <p className="font-bold mb-1 uppercase tracking-wider text-amber-400">Coverage Note:</p>
                                  {state.result.coverageNote}
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  // Scroll to top and focus input
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-[9px] font-bold text-amber-400 underline underline-offset-2 hover:text-amber-300"
                              >
                                Refine with Target Page
                              </button>
                            </div>
                          )}
                        </div>
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
                              ${(state.result.usageMetadata.cost || 0).toFixed(4)}
                            </span>
                          </div>
                        </>
                      )}
                      {state.result.extractionTime && (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold">Time Taken</span>
                          <span className="text-lg font-bold text-indigo-400">
                            {formatTime(state.result.extractionTime)}
                          </span>
                        </div>
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
                            <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest px-4 py-1 bg-white rounded-full border border-zinc-200 shadow-sm">
                              {mAb.mAbName}
                            </h3>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-1.5 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
                                <div 
                                  className={cn(
                                    "h-full transition-all duration-1000",
                                    mAb.confidence > 0.8 ? "bg-emerald-500" :
                                    mAb.confidence > 0.5 ? "bg-amber-500" : "bg-red-500"
                                  )}
                                  style={{ width: `${mAb.confidence * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">
                                {Math.round(mAb.confidence * 100)}% Confidence
                              </span>
                            </div>
                          </div>
                          <div className="h-px bg-zinc-200 flex-1" />
                        </div>
                        
                        <div className="grid grid-cols-1 gap-6">
                          {mAb.reasoning && (
                            <details className="group bg-zinc-50 border border-zinc-200 rounded-xl overflow-hidden">
                              <summary className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-zinc-100 transition-colors list-none">
                                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                                  <Search className="w-3 h-3" />
                                  AI Extraction Reasoning
                                </span>
                                <ChevronRight className="w-3 h-3 text-zinc-400 group-open:rotate-90 transition-transform" />
                              </summary>
                              <div className="px-4 py-3 text-xs text-zinc-600 leading-relaxed border-t border-zinc-200 bg-white">
                                {mAb.reasoning}
                                {mAb.validation && (
                                  <div className="mt-3 pt-3 border-t border-zinc-100 flex gap-4">
                                    <div className="flex items-center gap-1.5">
                                      <div className={cn("w-1.5 h-1.5 rounded-full", mAb.validation.cdrsMatchFullSequence ? "bg-emerald-500" : "bg-red-500")} />
                                      <span className="text-[9px] font-bold text-zinc-400 uppercase">CDRs Validated</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <div className={cn("w-1.5 h-1.5 rounded-full", mAb.validation.chainsPairedCorrectly ? "bg-emerald-500" : "bg-red-500")} />
                                      <span className="text-[9px] font-bold text-zinc-400 uppercase">Chains Paired</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
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
                          <span className="font-bold not-italic text-zinc-700 mr-2">Source Location:</span>
                          {mAb.reasoning}
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
