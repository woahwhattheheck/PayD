import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmployeeList } from '../../src/components/EmployeeList';
import { TableSkeleton } from '../../src/components/TableSkeleton';
import '../../src/index.css';

function Fixture() {
  const [state, setState] = useState('loading');
  const employeeView = new URLSearchParams(location.search).has('employees');
  const rowKeys = Array.from({ length: 20 }, (_, index) => `record-${index}`);
  const columnKeys = Array.from({ length: 6 }, (_, index) => `column-${index}`);
  const employees =
    state === 'loaded'
      ? [
          {
            id: '1',
            name: 'Test Employee',
            email: 'test@example.invalid',
            position: 'Engineer',
            wallet: '',
            salary: 2000,
            status: 'Active',
          },
        ]
      : [];
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <button onClick={() => setState('loaded')}>Show records</button>
        <button onClick={() => setState('empty')}>Show empty result</button>
        <button onClick={() => setState('loading')}>Reload</button>
      </div>
      {employeeView ? (
        <EmployeeList
          employees={employees}
          isLoading={state === 'loading'}
          onAddEmployee={() => {}}
        />
      ) : (
        <div className="payd-table-region">
          <table className="payd-data-table">
            <thead>
              <tr>
                {columnKeys.map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody aria-busy={state === 'loading'}>
              {state === 'loading' ? (
                <TableSkeleton rows={20} columns={6} label="Loading records" />
              ) : state === 'empty' ? (
                <tr>
                  <td colSpan={6}>No records</td>
                </tr>
              ) : (
                rowKeys.map((key) => (
                  <tr key={key}>
                    {columnKeys.map((column) => (
                      <td key={column}>{key}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <p data-testid="below-table">Content after the table</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Fixture />);
