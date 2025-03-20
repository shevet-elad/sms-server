require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors());

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const client = twilio(accountSid, authToken);

// Google Sheets API setup
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1Smej-ifRXVpPqJZZs9StraoupZ_XaKdmcoDttL42Ino'; // Your Google Sheet ID

// Function to get the first sheet title
async function getFirstSheetTitle() {
  try {
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId,
    });
    return metadata.data.sheets[0].properties.title;
  } catch (error) {
    console.error('Error getting sheet title:', error.message, error.stack);
    throw error;
  }
}

// Endpoint to send SMS verification code using Twilio Verify
app.post('/send-sms', async (req, res) => {
  const { to } = req.body;
  console.log('Request to send SMS (server): Received number:', to);

  // Ensure the phone number is in international format
  let formattedTo = to;
  if (!formattedTo.startsWith('+')) {
    formattedTo = '+972' + formattedTo.replace(/^0/, '');
  }

  console.log('Number after formatting:', formattedTo);

  try {
    const verification = await client.verify.v2
      .services(verifyServiceSid)
      .verifications.create({ to: formattedTo, channel: 'sms' });
    console.log('Response from Twilio (SMS sending):', verification);
    res.json(verification);
  } catch (error) {
    console.error('Error sending SMS (server):', error.message, error.code, error);
    res.status(500).json({ error: error.message, code: error.code });
  }
});

// Endpoint to verify the SMS code using Twilio Verify
app.post('/verify-sms', async (req, res) => {
  const { to, code } = req.body;
  console.log('Request to verify code (server):', { to, code, verifyServiceSid });

  // Ensure the phone number is in international format
  let formattedTo = to;
  if (!formattedTo.startsWith('+')) {
    formattedTo = '+972' + formattedTo.replace(/^0/, '');
  }

  try {
    const verificationCheck = await client.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({ to: formattedTo, code: code });
    console.log('Response from Twilio (code verification):', verificationCheck);
    res.json(verificationCheck);
  } catch (error) {
    console.error('Error verifying code (server):', error.message, error.code, error);
    res.status(500).json({ error: error.message, code: error.code });
  }
});

// Endpoint to save voting data to Google Sheet dynamically
app.post('/save-vote', async (req, res) => {
  const { phoneNumber, answers } = req.body;
  console.log('Request to save vote:', { phoneNumber, answers });

  // Validate the input data
  if (!phoneNumber || !answers || !Array.isArray(answers) || answers.length === 0) {
    console.error('Missing or invalid data:', { phoneNumber, answers });
    return res.status(400).json({ error: 'Missing or invalid data' });
  }

  try {
    const sheetTitle = await getFirstSheetTitle();
    const range = `${sheetTitle}!A${answers.length + 1}:B${answers.length + 1}`; // Dynamic range based on number of answers
    const values = [[phoneNumber, ...answers]];

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: range,
      valueInputOption: 'RAW',
      resource: { values },
    });

    console.log('Vote data saved successfully to Google Sheet:', response.data);
    res.status(200).json({ message: 'Vote data saved successfully' });
  } catch (error) {
    console.error('Error saving data to Google Sheet:', error.message, error.stack);
    res.status(500).json({ error: 'Error saving vote data' });
  }
});

// Endpoint to manage questions (admin functionality)
app.post('/manage-questions', async (req, res) => {
  const { action, question } = req.body;
  console.log('Request to manage questions:', { action, question });

  try {
    const sheetTitle = await getFirstSheetTitle();
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTitle}!A:A`,
    });
    const currentQuestions = getRows.data.values ? getRows.data.values.slice(1) : [];

    let updatedQuestions;
    if (action === 'add' && question) {
      updatedQuestions = [...currentQuestions, question];
    } else if (action === 'remove' && currentQuestions.length > 0) {
      updatedQuestions = currentQuestions.slice(0, -1);
    } else {
      return res.status(400).json({ error: 'Invalid action or no question provided' });
    }

    const values = [['Question'], ...updatedQuestions.map(q => [q])];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetTitle}!A:A`,
      valueInputOption: 'RAW',
      resource: { values },
    });

    console.log('Questions updated successfully');
    res.status(200).json({ message: 'Questions updated successfully', questions: updatedQuestions });
  } catch (error) {
    console.error('Error managing questions:', error.message, error.stack);
    res.status(500).json({ error: 'Error managing questions' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));