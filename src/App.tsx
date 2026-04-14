import React, { useState, useRef, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Upload,
  Download,
  Loader2,
  Link as LinkIcon,
  ArrowRight,
  Brain,
  CheckCircle,
  AlertCircle,
  X,
} from "lucide-react";

// --- Configuration & RAL Data ---
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const STARTER_RAL = import.meta.env.VITE_STARTER_RAL;

const RAL_COLORS = [
  { code: "RAL 1018", name: "Zinc Yellow", hex: "#F8F32B" },
  { code: "RAL 2004", name: "Pure Orange", hex: "#E75B12" },
  { code: "RAL 3020", name: "Traffic Red", hex: "#C1121C" },
  { code: "RAL 5002", name: "Ultramarine Blue", hex: "#2B2C7C" },
  { code: "RAL 6018", name: "Yellow Green", hex: "#57A639" },
  { code: "RAL 7016", name: "Anthracite Grey", hex: "#383E42" },
  { code: "RAL 7035", name: "Light Grey", hex: "#D7D7D7" },
  { code: "RAL 8017", name: "Chocolate Brown", hex: "#45322E" },
  { code: "RAL 9003", name: "Signal White", hex: "#F4F4F4" },
  { code: "RAL 9005", name: "Jet Black", hex: "#0A0A0A" },
];

type Model = {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
};

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRal, setCurrentRal] = useState(STARTER_RAL);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
    onRetry?: () => void;
  } | null>(null);
  const [maskPoints, setMaskPoints] = useState<[number, number][]>([]);

  const showStatus = (
    message: string,
    type: "success" | "error",
    onRetry?: () => void,
  ) => {
    setStatus({ type, message, onRetry });
  };

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  useEffect(() => {
    const fetchModels = async () => {
      setIsFetchingModels(true);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${API_KEY}`,
        );
        const data = await response.json();
        if (data.models) {
          const filteredModels = data.models.filter((m) =>
            m.supportedGenerationMethods.includes("generateContent"),
          );
          setModels(filteredModels);
          // If gemini-2.5-flash is not in the list, pick the first one
          if (
            !filteredModels.some((m) => m.name === "models/gemini-2.5-flash")
          ) {
            setSelectedModel(
              filteredModels[0]?.name.replace("models/", "") ||
                "gemini-2.5-flash",
            );
          }
        }
      } catch (err) {
        console.error("Error fetching models:", err);
      } finally {
        setIsFetchingModels(false);
      }
    };
    fetchModels();
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorlessBaseRef = useRef<HTMLCanvasElement | null>(null);

  const applyRalColor = (hex: string) => {
    const canvas = canvasRef.current;
    const base = colorlessBaseRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);

    if (maskPoints.length > 0) {
      ctx.save();
      // Create clipping path from mask
      ctx.beginPath();
      maskPoints.forEach(([y, x], index) => {
        const px = (x / 1000) * canvas.width;
        const py = (y / 1000) * canvas.height;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.clip();

      // Pass 1: Multiply - Best for white furniture as it preserves shadows but tints the white
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Pass 2: Overlay - Adds vividness and brings back highlights
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Pass 3: Color - Finalizes the hue consistency
      ctx.globalAlpha = 0.3;
      ctx.globalCompositeOperation = "color";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.restore();
    } else {
      // Fallback if no mask: simple color mode
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = "source-over";
  };

  const initCanvas = (imageUrl: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = img.width;
      baseCanvas.height = img.height;
      const bCtx = baseCanvas.getContext("2d");
      if (bCtx) {
        // Less aggressive filter to preserve natural lighting for multiply blending
        bCtx.filter = "grayscale(100%) brightness(105%) contrast(110%)";
        bCtx.drawImage(img, 0, 0);
        colorlessBaseRef.current = baseCanvas;
      }

      if (canvasRef.current) {
        canvasRef.current.width = img.width;
        canvasRef.current.height = img.height;
        const startColor =
          RAL_COLORS.find((r) => r.code === STARTER_RAL)?.hex || "#707070";
        applyRalColor(startColor);
      }
    };
    img.onerror = () => {
      showStatus(
        "Could not load image. This might be due to CORS restrictions on the host site.",
        "error",
      );
    };
  };

  // Process image with Gemini
  const triggerGeminiAnalysis = async (
    base64Data: string,
    modelOverride?: string,
  ) => {
    setIsProcessing(true);
    setMaskPoints([]); // Clear old mask
    try {
      const genAI = new GoogleGenerativeAI(API_KEY);
      const model = genAI.getGenerativeModel(
        { model: modelOverride || selectedModel },
        { apiVersion: "v1" },
      );

      const prompt = `
        Identify the main piece of furniture in this image.
        Return a JSON object with:
        1. "texture": describe the surface (e.g. "matte wood", "glossy metal").
        2. "polygon": a list of [y, x] coordinates (normalized 0-1000) that form a detailed mask around the furniture.
        
        Return ONLY valid JSON.
      `;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: "image/png" } },
      ]);

      const response = result.response;
      const text = response.text();

      // Extract JSON from response (handling potential markdown blocks)
      const jsonStr = text.substring(
        text.indexOf("{"),
        text.lastIndexOf("}") + 1,
      );
      const data = JSON.parse(jsonStr);

      if (data.polygon && Array.isArray(data.polygon)) {
        setMaskPoints(data.polygon);
        showStatus(
          `Object identified: ${data.texture || "Furniture"}. Masking active.`,
          "success",
        );
      } else {
        showStatus(
          "Could not generate precision mask. Using fallback.",
          "error",
        );
      }
    } catch (err) {
      showStatus("Gemini Error: " + (err.message || err), "error", () =>
        triggerGeminiAnalysis(base64Data, modelOverride),
      );
      console.error("Gemini Error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper to convert img to base64 for Gemini
  const getBase64FromUrl = async (url: string): Promise<string> => {
    const data = await fetch(url);
    const blob = await data.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => resolve(reader.result as string);
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setImage(base64);
      initCanvas(base64);
      triggerGeminiAnalysis(base64.split(",")[1]);
    };
    reader.readAsDataURL(file);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput) return;
    try {
      setIsProcessing(true);
      // We fetch the image first to check for CORS and convert to base64 for Gemini
      const base64 = await getBase64FromUrl(imageUrlInput);
      setImage(base64);
      initCanvas(base64);
      triggerGeminiAnalysis(base64.split(",")[1]);
    } catch (err) {
      console.error("Gemini Error:", err);
      showStatus(
        "CORS Error: The image provider does not allow external scripts to access this image.",
        "error",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-200 p-4 md:p-8 flex flex-col items-center">
      <header className="w-full max-w-6xl flex justify-between items-center mb-8 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            RAL PREVIEW <span className="text-blue-500">PRO</span>
          </h1>
          <p className="text-slate-500 text-sm italic">
            Universal Color Visualizer
          </p>
        </div>
        {image && (
          <button
            onClick={() => {
              const link = document.createElement("a");
              link.download = `${currentRal}-preview.png`;
              link.href = canvasRef.current!.toDataURL();
              link.click();
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition"
          >
            <Download size={16} /> Export
          </button>
        )}
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-3 space-y-6 order-2 lg:order-1">
          {/* Model Selection */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex items-center gap-2">
              <Brain size={14} className="text-blue-500" />
              AI Intelligence
            </h3>
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => {
                  const newModel = e.target.value;
                  setSelectedModel(newModel);
                  if (image) {
                    const shouldReanalyze = window.confirm(
                      `Switch to ${newModel}? This will re-analyze your photo for better accuracy.`,
                    );
                    if (shouldReanalyze) {
                      triggerGeminiAnalysis(image.split(",")[1], newModel);
                    }
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 appearance-none cursor-pointer transition text-white"
                disabled={isFetchingModels}
              >
                {isFetchingModels ? (
                  <option>Loading models...</option>
                ) : models.length > 0 ? (
                  models.map((m) => (
                    <option key={m.name} value={m.name.replace("models/", "")}>
                      {m.displayName || m.name.replace("models/", "")}
                    </option>
                  ))
                ) : (
                  <option value="gemini-2.5-flash">
                    Gemini 2.5 Flash (Default)
                  </option>
                )}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                {isFetchingModels ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2.5 4.5L6 8L9.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 my-2"></div>

          {!image ? (
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">
                Import Image
              </h3>

              {/* URL Input */}
              <form onSubmit={handleUrlSubmit} className="relative group">
                <input
                  type="text"
                  placeholder="Paste image URL..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition pl-10 pr-12"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                />
                <LinkIcon
                  className="absolute left-3 top-3.5 text-slate-600"
                  size={16}
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all flex items-center justify-center"
                  title="Load image from URL"
                >
                  <ArrowRight size={16} />
                </button>
              </form>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-4 text-slate-600 text-[10px] font-bold">
                  OR
                </span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              {/* File Upload */}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl p-6 hover:bg-slate-900/50 cursor-pointer transition group">
                <Upload
                  className="text-slate-600 group-hover:text-blue-400 mb-2"
                  size={20}
                />
                <span className="text-xs text-slate-500">Local PNG/JPG</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="image/*"
                />
              </label>
            </div>
          ) : (
            <>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">
                RAL Colors
              </h3>
              <div className="grid grid-cols-1 gap-2 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                {RAL_COLORS.map((ral) => (
                  <button
                    key={ral.code}
                    onClick={() => {
                      setCurrentRal(ral.code);
                      applyRalColor(ral.hex);
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      currentRal === ral.code
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-800 bg-slate-900/50 hover:border-slate-600"
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-lg shadow-inner"
                      style={{ backgroundColor: ral.hex }}
                    />
                    <div className="text-left">
                      <div className="text-xs font-bold text-white">
                        {ral.code}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase leading-tight">
                        {ral.name}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setImage(null);
                  setImageUrlInput("");
                }}
                className="w-full text-xs text-slate-600 hover:text-slate-400 py-2 border-t border-slate-800 mt-4"
              >
                Upload New Image
              </button>
            </>
          )}
        </div>

        {/* Visualizer Area */}
        <div className="lg:col-span-9 bg-slate-900 rounded-3xl border border-slate-800 relative min-h-[550px] flex items-center justify-center overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:20px_20px] order-1 lg:order-2">
          {!image && (
            <div className="text-center opacity-40">
              <div className="w-24 h-24 bg-slate-800 rounded-full mx-auto flex items-center justify-center mb-4">
                <LinkIcon size={32} />
              </div>
              <p className="text-sm font-medium">Ready to Visualize</p>
            </div>
          )}

          {isProcessing && (
            <div className="absolute inset-0 z-20 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-blue-500 mb-2" size={32} />
              <span className="text-[10px] font-mono text-blue-400 uppercase tracking-[0.2em]">
                Gemini_Sync_Active
              </span>
            </div>
          )}

          {image && (
            <div className="p-12 w-full h-full flex flex-col items-center justify-center">
              <div className="relative group">
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-[70vh] drop-shadow-2xl"
                />
                {maskPoints.length > 0 && (
                  <div className="absolute top-4 left-4 bg-emerald-500/80 backdrop-blur-sm text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle size={12} /> AI Mask Active
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Notifications */}
      {status && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`flex items-center gap-3 px-6 py-3 rounded-2xl backdrop-blur-xl border shadow-2xl transition-all ${
              status.type === "success"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                : "bg-rose-500/20 border-rose-500/40 text-rose-400"
            }`}
          >
            {status.type === "success" ? (
              <CheckCircle size={18} />
            ) : (
              <AlertCircle size={18} />
            )}
            <span className="text-sm font-semibold tracking-wide">
              {status.message}
            </span>
            {status.onRetry && (
              <button
                onClick={() => {
                  status.onRetry?.();
                  setStatus(null);
                }}
                className="ml-2 px-3 py-1 bg-rose-500/20 hover:bg-rose-500/40 border border-rose-500/50 rounded-lg text-[10px] font-bold uppercase tracking-widest transition"
              >
                Retry
              </button>
            )}
            <button
              onClick={() => setStatus(null)}
              className="ml-2 hover:opacity-70 transition p-1"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
