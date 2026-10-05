import React, { useState, useRef, useEffect } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { parseCSVPreview } from '../utils/csvPreview';
import type { CSVRow } from '../utils/csvPreview';

export type { CSVRow } from '../utils/csvPreview';

interface CSVUploaderProps {
  requiredColumns: string[];
  onDataParsed: (data: CSVRow[], csvContent: string) => void;
  validators?: Record<string, (value: string) => string | null>;
}

export const CSVUploader: React.FC<CSVUploaderProps> = ({
  requiredColumns,
  onDataParsed,
  validators = {},
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [parsedData, setParsedData] = useState<CSVRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);

  // Modified 2026-10-05: prevent replaced or unmounted reads from publishing CSV data.
  useEffect(() => () => {
    readGeneration.current += 1;
  }, []);

  const handleFileParse = (file: File) => {
    const generation = ++readGeneration.current;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setParsedData([]);
    setFileName(null);
    onDataParsed([], '');
    if (generation !== readGeneration.current) return;

    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    const handleReadError = () => {
      if (generation === readGeneration.current) {
        alert('Unable to read the CSV file. Please select it again.');
      }
    };

    reader.onload = (e) => {
      if (generation !== readGeneration.current) return;
      const content = e.target?.result;
      if (typeof content !== 'string') {
        handleReadError();
        return;
      }
      let rows: CSVRow[];
      try {
        rows = parseCSVPreview(content, requiredColumns, validators);
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Unable to parse the CSV file');
        return;
      }
      if (generation !== readGeneration.current) return;
      setParsedData(rows);
      onDataParsed(rows, content);
    };
    reader.onerror = handleReadError;
    reader.onabort = handleReadError;

    try {
      reader.readAsText(file);
    } catch {
      handleReadError();
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileParse(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileParse(file);
    }
  };

  const validRowsCount = parsedData.filter((r) => r.isValid).length;
  const invalidRowsCount = parsedData.filter((r) => !r.isValid).length;

  return (
    <div className="w-full">
      {/* Upload Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-(--border-hi) bg-(--surface-hi) hover:border-(--muted)'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />

        <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full">
          <Upload className="w-12 h-12 mx-auto mb-2 text-(--muted)" />
          <p className="text-lg font-semibold text-(--text)">Drag and drop your CSV file</p>
          <p className="text-sm text-(--muted) mt-1">or click to browse</p>
          <p className="text-xs text-(--muted) mt-2">
            Required columns: {requiredColumns.join(', ')}
          </p>
        </button>
      </div>

      {/* File info */}
      {fileName && (
        <div className="mt-4 text-left p-3 bg-transparent border rounded text-sm">
          <p className="font-semibold">File: {fileName}</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <CheckCircle className="w-4 h-4 text-green-100" />
              {validRowsCount} valid rows
            </span>
            {invalidRowsCount > 0 && (
              <span className="flex items-center gap-1">
                <AlertCircle className="w-4 h-4 text-red-500" />
                {invalidRowsCount} rows with errors
              </span>
            )}
          </div>
        </div>
      )}

      {/* Preview Table */}
      {parsedData.length > 0 && (
        <div className="mt-6">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h3 className="text-lg font-semibold">Preview</h3>
            <span className="text-xs text-(--muted)">
              Showing first {Math.min(20, parsedData.length)} of {parsedData.length} rows
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-semibold">Row</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                  {Object.keys(parsedData[0]?.data || {}).map((col) => (
                    <th key={col} className="px-4 py-2 text-left font-semibold">
                      {col}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-left font-semibold">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {parsedData.slice(0, 20).map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`border-b transition ${
                      row.isValid ? 'bg-transparent' : 'bg-red-50'
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-(--text)">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      {row.isValid ? (
                        <CheckCircle className="w-5 h-5 text-green-100" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-100" />
                      )}
                    </td>

                    {Object.entries(row.data).map(([col, value]) => (
                      <td
                        key={`${row.rowNumber}-${col}`}
                        className="px-4 py-3 text-(--text) truncate"
                      >
                        {value}
                      </td>
                    ))}

                    <td className="px-4 py-3 text-red-600 text-xs">
                      {row.errors.length > 0 ? (
                        <ul className="space-y-1">
                          {row.errors.map((error) => (
                            <li key={`${row.rowNumber}-${error}`}>• {error}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-green-600">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
