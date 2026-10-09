import { readEnv } from '../config/env.js';
import PDFDocument from 'pdfkit';
import { pool } from '../config/database.js';
import { TransactionAuditService } from './transactionAuditService.js';
import { StellarService } from './stellarService.js';
import logger from '../utils/logger.js';
import QRCode from 'qrcode';

export interface CertificateData {
  employeeId: number;
  transactionHash: string;
  organizationId: number;
}

export interface PaymentCertificateInfo {
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    position?: string;
    department?: string;
  };
  organization: {
    id: number;
    name: string;
  };
  transaction: {
    hash: string;
    amount: string;
    assetCode: string;
    status: string;
    createdAt: string;
    ledgerSequence: number;
    sourceAccount: string;
  };
  verificationUrl: string;
}

export class PDFCertificateService {
  /**
   * Generate a verifiable PDF certificate for a payment transaction
   */
  static async generateCertificate(
    data: CertificateData
  ): Promise<Buffer> {
    try {
      // Fetch all required data
      const certificateInfo = await this.fetchCertificateData(data);

      // Generate PDF
      const pdfBuffer = await this.createPDF(certificateInfo);

      return pdfBuffer;
    } catch (error) {
      logger.error('Failed to generate PDF certificate', error);
      throw error;
    }
  }

  /**
   * Fetch employee and organization ID from transaction hash
   */
  static async getTransactionEmployeeInfo(
    transactionHash: string
  ): Promise<{ employeeId: number; organizationId: number } | null> {
    // Try to get from transactions table first
    const txResult = await pool.query(
      `SELECT employee_id, organization_id
       FROM transactions
       WHERE tx_hash = $1`,
      [transactionHash]
    );

    if (txResult.rows.length > 0 && txResult.rows[0].employee_id) {
      return {
        employeeId: txResult.rows[0].employee_id,
        organizationId: txResult.rows[0].organization_id,
      };
    }

    // Try payroll_items table
    const payrollResult = await pool.query(
      `SELECT pi.employee_id, pr.organization_id
       FROM payroll_items pi
       JOIN payroll_runs pr ON pi.payroll_run_id = pr.id
       WHERE pi.tx_hash = $1`,
      [transactionHash]
    );

    if (payrollResult.rows.length > 0 && payrollResult.rows[0].employee_id) {
      return {
        employeeId: payrollResult.rows[0].employee_id,
        organizationId: payrollResult.rows[0].organization_id,
      };
    }

    return null;
  }

  /**
   * Fetch all data needed for the certificate
   */
  private static async fetchCertificateData(
    data: CertificateData
  ): Promise<PaymentCertificateInfo> {
    // Fetch employee information
    const employeeResult = await pool.query(
      `SELECT id, first_name, last_name, email, position, department
       FROM employees
       WHERE id = $1 AND organization_id = $2`,
      [data.employeeId, data.organizationId]
    );

    if (employeeResult.rows.length === 0) {
      throw new Error('Employee not found');
    }

    const employee = employeeResult.rows[0];

    // Fetch organization information
    const orgResult = await pool.query(
      `SELECT id, name FROM organizations WHERE id = $1`,
      [data.organizationId]
    );

    if (orgResult.rows.length === 0) {
      throw new Error('Organization not found');
    }

    const organization = orgResult.rows[0];

    // Fetch transaction information from audit logs (or fetch from Horizon if not found)
    let auditRecord = await TransactionAuditService.getByHash(data.transactionHash);
    
    if (!auditRecord) {
      // Try to fetch and store from Horizon
      try {
        auditRecord = await TransactionAuditService.fetchAndStore(data.transactionHash);
      } catch (error) {
        logger.warn('Could not fetch transaction from Horizon, continuing without audit record', error);
        // Continue without audit record - we'll use transaction table data
      }
    }

    // Fetch transaction details from transactions table
    let txResult = await pool.query(
      `SELECT amount, asset_code, status, created_at
       FROM transactions
       WHERE tx_hash = $1 AND employee_id = $2`,
      [data.transactionHash, data.employeeId]
    );

    // If not found in transactions, try payroll_items
    if (txResult.rows.length === 0) {
      txResult = await pool.query(
        `SELECT 
          CAST(pi.amount AS TEXT) as amount,
          pr.asset_code,
          pi.status,
          pi.created_at
         FROM payroll_items pi
         JOIN payroll_runs pr ON pi.payroll_run_id = pr.id
         WHERE pi.tx_hash = $1 AND pi.employee_id = $2`,
        [data.transactionHash, data.employeeId]
      );
    }

    if (txResult.rows.length === 0) {
      throw new Error('Transaction not found for this employee');
    }

    const transaction = txResult.rows[0];

    // Construct verification URL (using Horizon explorer or custom verification endpoint)
    const network = readEnv('STELLAR_NETWORK') || 'testnet';
    const horizonUrl = network === 'mainnet' 
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';
    const verificationUrl = `${horizonUrl}/transactions/${data.transactionHash}`;

    return {
      employee: {
        id: employee.id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        email: employee.email,
        position: employee.position || undefined,
        department: employee.department || undefined,
      },
      organization: {
        id: organization.id,
        name: organization.name,
      },
      transaction: {
        hash: data.transactionHash,
        amount: transaction.amount,
        assetCode: transaction.asset_code,
        status: transaction.status,
        createdAt: transaction.created_at,
        ledgerSequence: auditRecord?.ledger_sequence || 0,
        sourceAccount: auditRecord?.source_account || 'Unknown',
      },
      verificationUrl,
    };
  }

  /**
   * Create the PDF document
   */
  private static async createPDF(
    info: PaymentCertificateInfo
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const buffers: Buffer[] = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // Header
      doc
        .fontSize(24)
        .font('Helvetica-Bold')
        .text('PROOF OF PAYMENT CERTIFICATE', { align: 'center' })
        .moveDown(1);

      // Certificate Number
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Certificate ID: ${info.transaction.hash.substring(0, 16).toUpperCase()}`, {
          align: 'center',
        })
        .moveDown(2);

      // Organization Section
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Issuing Organization', { underline: true })
        .moveDown(0.5)
        .fontSize(12)
        .font('Helvetica')
        .text(`Organization: ${info.organization.name}`)
        .text(`Organization ID: ${info.organization.id}`)
        .moveDown(1);

      // Employee Section
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Employee Information', { underline: true })
        .moveDown(0.5)
        .fontSize(12)
        .font('Helvetica')
        .text(`Name: ${info.employee.firstName} ${info.employee.lastName}`)
        .text(`Email: ${info.employee.email}`)
        .text(`Employee ID: ${info.employee.id}`);

      if (info.employee.position) {
        doc.text(`Position: ${info.employee.position}`);
      }
      if (info.employee.department) {
        doc.text(`Department: ${info.employee.department}`);
      }

      doc.moveDown(1);

      // Payment Details Section
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Payment Details', { underline: true })
        .moveDown(0.5)
        .fontSize(12)
        .font('Helvetica')
        .text(`Amount: ${info.transaction.amount} ${info.transaction.assetCode}`)
        .text(`Status: ${info.transaction.status.toUpperCase()}`)
        .text(
          `Payment Date: ${new Date(info.transaction.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}`
        )
        .moveDown(1);

      // Transaction Verification Section
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('Transaction Verification', { underline: true })
        .moveDown(0.5)
        .fontSize(12)
        .font('Helvetica')
        .text(`Transaction Hash: ${info.transaction.hash}`, {
          continued: false,
        })
        .text(`Ledger Sequence: ${info.transaction.ledgerSequence}`)
        .text(`Source Account: ${info.transaction.sourceAccount}`)
        .moveDown(1);

      // Verification Instructions
      doc
        .fontSize(11)
        .font('Helvetica-Oblique')
        .text(
          'This certificate can be verified by checking the transaction on the Stellar blockchain using the transaction hash above.',
          {
            align: 'justify',
          }
        )
        .moveDown(1);

      // Generate QR Code
      try {
        void QRCode.toDataURL(info.verificationUrl, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          width: 150,
          margin: 1,
        })
          .then((qrCodeDataUrl: string) => {
            const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
            const qrImage = Buffer.from(base64Data, 'base64');

            doc.image(qrImage, {
              fit: [150, 150],
              align: 'center',
            });

            doc
              .fontSize(10)
              .font('Helvetica')
              .text('Scan QR code to verify transaction', {
                align: 'center',
              })
              .moveDown(1);
          })
          .catch((qrError: any) => {
            logger.warn('Failed to generate QR code', qrError);
          });
      } catch (qrError) {
        logger.warn('Failed to generate QR code', qrError);
        // Continue without QR code
      }

      // Footer
      const pageHeight = doc.page.height;
      const pageWidth = doc.page.width;
      doc
        .fontSize(9)
        .font('Helvetica-Oblique')
        .text(
          `Generated on ${new Date().toLocaleString('en-US', {
            timeZone: 'UTC',
            dateStyle: 'long',
            timeStyle: 'short',
          })} UTC`,
          pageWidth - 100,
          pageHeight - 50,
          {
            align: 'right',
            width: 100,
          }
        )
        .text(
          'This is a computer-generated document. Verify authenticity using the transaction hash.',
          pageWidth - 100,
          pageHeight - 35,
          {
            align: 'right',
            width: 100,
          }
        );

      // Add verification link at bottom
      doc
        .fontSize(8)
        .font('Helvetica')
        .text(`Verification URL: ${info.verificationUrl}`, {
          align: 'center',
          link: info.verificationUrl,
        });

      doc.end();
    });
  }

  /**
   * Verify a transaction hash matches the certificate
   */
  static async verifyCertificate(
    transactionHash: string,
    employeeId: number,
    organizationId: number
  ): Promise<{ verified: boolean; details?: PaymentCertificateInfo }> {
    try {
      const verification = await TransactionAuditService.verify(transactionHash);

      if (!verification.verified || !verification.record) {
        return { verified: false };
      }

      // Check if transaction belongs to the employee
      const txResult = await pool.query(
        `SELECT employee_id, organization_id
         FROM transactions
         WHERE tx_hash = $1`,
        [transactionHash]
      );

      if (
        txResult.rows.length === 0 ||
        txResult.rows[0].employee_id !== employeeId ||
        txResult.rows[0].organization_id !== organizationId
      ) {
        return { verified: false };
      }

      const certificateData: CertificateData = {
        employeeId,
        transactionHash,
        organizationId,
      };

      const details = await this.fetchCertificateData(certificateData);

      return { verified: true, details };
    } catch (error) {
      logger.error('Certificate verification failed', error);
      return { verified: false };
    }
  }
}
