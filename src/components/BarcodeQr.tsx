import React, { useEffect, useId, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, ScanLine } from 'lucide-react';

export function Code128Barcode({
  value,
  height = 38,
  width = 1.4,
  displayValue = true,
  className = '',
}: {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        lineColor: '#0f172a',
        background: '#ffffff',
        width,
        height,
        displayValue,
        fontSize: 11,
        font: 'JetBrains Mono, monospace',
        margin: 4,
      });
    } catch (err) {
      console.error('Barcode render error:', err);
    }
  }, [value, height, width, displayValue]);

  return (
    <svg
      ref={svgRef}
      aria-label={`Code 128 barcode for ${value}`}
      className={`max-w-full bg-white ${className}`}
    />
  );
}

export function QrCodeGraphic({
  payload,
  size = 92,
  className = '',
}: {
  payload: string;
  size?: number;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!payload) return;
    QRCode.toDataURL(payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f294d', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch((err) => console.error('QR generation error:', err));
    return () => {
      active = false;
    };
  }, [payload, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center bg-slate-100 text-[10px] text-slate-400 ${className}`}
      >
        QR
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`QR Code for ${payload}`}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className={`bg-white p-0.5 ${className}`}
    />
  );
}

export function BookCopyLabelCard({
  accessionNumber,
  bookTitle,
  qrPayload,
  shelfNumber,
  rackNumber,
  institutionName = 'HALDIA INSTITUTE OF TECHNOLOGY',
  departmentName = 'DEPT. OF CIVIL ENGINEERING',
  compact = false,
}: {
  accessionNumber: string;
  bookTitle: string;
  qrPayload: string;
  shelfNumber?: string;
  rackNumber?: string;
  institutionName?: string;
  departmentName?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`print-break-avoid rounded-lg border border-slate-300 bg-white text-slate-900 ${
        compact ? 'p-2.5' : 'p-3.5'
      }`}
    >
      <div className="border-b border-slate-200 pb-1.5 text-center">
        <div className="text-[10px] font-bold tracking-wide text-[#0f294d]">{institutionName}</div>
        <div className="text-[9px] font-medium text-slate-600">{departmentName}</div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">
            {bookTitle}
          </div>
          <div className="mt-1 font-mono text-xs font-bold text-[#0f294d]">{accessionNumber}</div>
          {(shelfNumber || rackNumber) && (
            <div className="mt-0.5 text-[10px] text-slate-500">
              Shelf {shelfNumber || '—'} · Rack {rackNumber || '—'}
            </div>
          )}
        </div>
        <QrCodeGraphic payload={qrPayload || accessionNumber} size={compact ? 64 : 78} className="shrink-0 rounded border border-slate-200" />
      </div>

      <div className="mt-2 flex justify-center border-t border-slate-100 pt-1.5">
        <Code128Barcode value={accessionNumber} height={compact ? 26 : 32} width={compact ? 1.1 : 1.3} displayValue={true} />
      </div>
    </div>
  );
}

export function CameraQrScanner({
  onScan,
}: {
  onScan: (decodedText: string) => void;
}) {
  const rawId = useId();
  const containerId = `hit-qr-reader-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = async () => {
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
    } catch {
      // ignore stop errors
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setErrorMsg(null);
    try {
      const html5Qr = new Html5Qrcode(containerId);
      scannerRef.current = html5Qr;
      setScanning(true);
      await html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          onScan(decodedText);
          void stopCamera();
        },
        () => {
          // ignore per-frame decode misses
        }
      );
    } catch (err: any) {
      setScanning(false);
      setErrorMsg(
        err?.message ||
          'Camera permission denied or no camera detected. You can use a USB barcode scanner or enter the accession number manually.'
      );
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          <ScanLine className="h-4 w-4 text-[#0891b2]" />
          <span>Webcam / Mobile Camera QR & Barcode Scanner</span>
        </div>
        {!scanning ? (
          <button
            type="button"
            onClick={startCamera}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0f294d] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
          >
            <Camera className="h-3.5 w-3.5" />
            Start Camera Scanner
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopCamera()}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap shrink-0"
          >
            <CameraOff className="h-3.5 w-3.5" />
            Stop Camera
          </button>
        )}
      </div>

      <div
        id={containerId}
        className={`mt-2 overflow-hidden rounded-md bg-slate-950 ${scanning ? 'min-h-[240px]' : 'h-0'}`}
      />

      {errorMsg && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400" role="alert">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
