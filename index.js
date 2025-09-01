const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

// Gmail transporter setup
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Activity log for monitoring
let activityLog = [];

function logActivity(message) {
  const timestamp = new Date().toISOString();
  activityLog.push({ timestamp, message });
  console.log(`[${timestamp}] ${message}`);
  
  // Keep only last 100 entries
  if (activityLog.length > 100) {
    activityLog = activityLog.slice(-100);
  }
}

// Helper function to format payment details
function formatPaymentDetails(paymentData, eventType) {
  const isCharge = eventType === 'charge.failed';
  const isInvoice = eventType === 'invoice.payment_failed';
  
  let details = '';
  
  if (isCharge) {
    const charge = paymentData;
    details = `
Payment Details:
- Amount: $${(charge.amount / 100).toFixed(2)} ${charge.currency.toUpperCase()}
- Customer: ${charge.billing_details?.name || 'N/A'}
- Email: ${charge.billing_details?.email || 'N/A'}
- Payment Method: ${charge.payment_method_details?.type || 'N/A'}
- Card Last 4: ${charge.payment_method_details?.card?.last4 || 'N/A'}
- Failure Code: ${charge.failure_code || 'N/A'}
- Failure Message: ${charge.failure_message || 'N/A'}
- Created: ${new Date(charge.created * 1000).toLocaleString()}
- Charge ID: ${charge.id}`;
  } else if (isInvoice) {
    const invoice = paymentData;
    details = `
Invoice Payment Details:
- Amount: $${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}
- Customer ID: ${invoice.customer || 'N/A'}
- Subscription ID: ${invoice.subscription || 'N/A'}
- Invoice Number: ${invoice.number || 'N/A'}
- Due Date: ${new Date(invoice.due_date * 1000).toLocaleDateString()}
- Created: ${new Date(invoice.created * 1000).toLocaleString()}
- Invoice ID: ${invoice.id}
- Status: ${invoice.status}`;
  }
  
  return details;
}

// Send email notification
async function sendFailureNotification(eventType, paymentData) {
  try {
    const subject = eventType === 'charge.failed' 
      ? `🚨 Stripe Payment Failed - $${(paymentData.amount / 100).toFixed(2)}`
      : `🚨 Stripe Invoice Payment Failed - $${(paymentData.amount_due / 100).toFixed(2)}`;
    
    const details = formatPaymentDetails(paymentData, eventType);
    
    const mailOptions = {
      from: process.env.GMAIL_EMAIL,
      to: 'balkeecom02@gmail.com',
      subject: subject,
      text: `A payment failure occurred in your Stripe account.

Event Type: ${eventType}
${details}

Please check your Stripe dashboard for more details: https://dashboard.stripe.com/payments

This alert was sent by your automated payment monitoring system.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #dc3545;">🚨 Payment Failure Alert</h2>
          <p>A payment failure occurred in your Stripe account.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <strong>Event Type:</strong> ${eventType}<br>
            <pre style="white-space: pre-wrap; font-family: monospace; margin-top: 10px;">${details}</pre>
          </div>
          
          <p>
            <a href="https://dashboard.stripe.com/payments" 
               style="background-color: #635bff; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">
              View in Stripe Dashboard
            </a>
          </p>
          
          <hr style="margin: 20px 0;">
          <small style="color: #666;">
            This alert was sent by your automated payment monitoring system.
          </small>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    logActivity(`Email notification sent for ${eventType} - ${paymentData.id}`);
    return true;
  } catch (error) {
    logActivity(`Failed to send email: ${error.message}`);
    throw error;
  }
}

// Webhook endpoint for Stripe events
app.post('/webhook/stripe', async (req, res) => {
  try {
    const event = req.body;
    logActivity(`Received Stripe webhook: ${event.type}`);

    if (event.type === 'charge.failed') {
      const charge = event.data.object;
      await sendFailureNotification('charge.failed', charge);
      logActivity(`Processed charge failure: ${charge.id}`);
    } 
    else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      await sendFailureNotification('invoice.payment_failed', invoice);
      logActivity(`Processed invoice payment failure: ${invoice.id}`);
    }

    res.json({ received: true });
  } catch (error) {
    logActivity(`Webhook error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Status endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    service: 'Stripe Payment Failure Monitor',
    endpoints: {
      'POST /webhook/stripe': 'Receives Stripe webhook events',
      'GET /health': 'Health check',
      'GET /logs': 'View recent activity',
      'POST /test': 'Manual test notification'
    },
    monitoring: [
      'charge.failed',
      'invoice.payment_failed'
    ],
    notification_target: 'balkeecom02@gmail.com'
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test Stripe connection
    await stripe.accounts.retrieve();
    
    // Test Gmail connection
    await transporter.verify();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        stripe: 'connected',
        gmail: 'connected'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// View recent logs
app.get('/logs', (req, res) => {
  res.json({
    recent_activity: activityLog.slice(-20),
    total_entries: activityLog.length
  });
});

// Manual test endpoint
app.post('/test', async (req, res) => {
  try {
    const testCharge = {
      id: 'ch_test_' + Date.now(),
      amount: 2500,
      currency: 'usd',
      billing_details: {
        name: 'Test Customer',
        email: 'test@example.com'
      },
      payment_method_details: {
        type: 'card',
        card: { last4: '4242' }
      },
      failure_code: 'card_declined',
      failure_message: 'Your card was declined (test mode)',
      created: Math.floor(Date.now() / 1000)
    };

    await sendFailureNotification('charge.failed', testCharge);
    
    res.json({
      success: true,
      message: 'Test notification sent to balkeecom02@gmail.com'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logActivity(`Stripe Payment Failure Monitor started on port ${PORT}`);
});

module.exports = app;