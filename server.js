const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const cors = require('cors');
const path = require('path');
const app = express();
const port = 3000;

// Google Sheets setup
const doc = new GoogleSpreadsheet('1Smej-ifRXVpPqJZZs9StraoupZ_XaKdmcoDttL42Ino');
let creds;
try {
    creds = require('./credentials.json');
} catch (error) {
    console.error('Error loading credentials.json:', error.message);
    creds = null;
}

// Flag to track if Google Sheets is initialized
let isGoogleSheetsInitialized = false;

// Default questions array with corrected question mark placement
let questions = [
    { question: 'האם אתה תומך בהצעה להאריך את שעות הפעילות של המרכז הקהילתי?', description: '', active: true },
    { question: 'האם אתה בעד הקמת גינה קהילתית חדשה בשכונה?', description: '', active: true }
];

// Temporary array to store votes if Google Sheets is unavailable
let localVotes = [];

// Middleware setup
app.use(cors());
app.use(express.json());

// Serve static files from the voting-app directory
app.use(express.static(path.join(__dirname, '..', 'voting-app'), {
    index: false // Prevent serving index.html by default
}));

// Function to initialize Google Sheets with detailed logging
async function initializeGoogleSheets() {
    if (!creds) {
        console.log('No credentials found. Please ensure credentials.json exists and is valid.');
        return false;
    }

    try {
        const auth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive.file',
            ],
        });

        doc.auth = auth;

        console.log('Authenticating with Google Sheets...');
        await doc.loadInfo();
        console.log('Google Sheets initialized successfully. Spreadsheet title:', doc.title);
        return true;
    } catch (error) {
        console.error('Error initializing Google Sheets:');
        console.error('Error message:', error.message);
        if (error.response) {
            console.error('Error response:', error.response.data);
        }
        return false;
    }
}

// Load questions from Google Sheets
async function loadQuestions() {
    isGoogleSheetsInitialized = await initializeGoogleSheets();

    if (!isGoogleSheetsInitialized) {
        console.log('Using default questions due to Google Sheets initialization failure.');
        return;
    }

    try {
        const sheet = doc.sheetsByIndex[0];
        console.log('Loading questions from sheet:', sheet.title);

        await sheet.loadHeaderRow();
        console.log('Header values:', sheet.headerValues);

        const rows = await sheet.getRows();
        console.log('Raw rows from Google Sheets:', rows);

        const loadedQuestions = rows
            .filter(row => {
                const hasQuestion = row.get('question') && row.get('question').trim() !== '';
                if (!hasQuestion) {
                    console.log('Skipping row due to missing or empty question:', row);
                }
                return hasQuestion;
            })
            .map(row => {
                let questionText = row.get('question');
                // Fix question mark placement
                if (questionText.startsWith('?')) {
                    questionText = questionText.substring(1).trim() + '?';
                }
                const question = {
                    question: questionText,
                    description: row.get('description') || '',
                    active: row.get('active') === 'TRUE'
                };
                console.log('Processed question:', question);
                return question;
            });

        if (loadedQuestions.length > 0) {
            questions = loadedQuestions;
            console.log('Loaded questions from Google Sheets:', questions);
        } else {
            console.log('No valid questions found in Google Sheets, using default questions.');
        }

        if (rows.length === 0) {
            console.log('No rows found in Google Sheets, adding default questions.');
            await sheet.addRows(questions);
        }
    } catch (error) {
        console.error('Error loading questions from Google Sheets:', error.message);
        console.log('Falling back to default questions.');
    }
}

// Load questions when the server starts
loadQuestions();

// API to get questions
app.get('/api/questions', (req, res) => {
    console.log('Sending questions to client:', questions);
    res.json(questions);
});

// API to submit a vote
app.post('/api/vote', async (req, res) => {
    const { phoneNumber, answers } = req.body;

    const voteData = {
        phoneNumber,
        timestamp: new Date().toISOString()
    };

    questions.forEach((q, i) => {
        voteData[`question_${i + 1}`] = q.question;
        voteData[`answer_${i + 1}`] = answers[i] || 'לא נענה';
    });

    localVotes.push(voteData);

    if (isGoogleSheetsInitialized) {
        try {
            const sheet = doc.sheetsByIndex[1];

            const headers = ['phoneNumber', 'timestamp'];
            questions.forEach((_, i) => {
                headers.push(`question_${i + 1}`, `answer_${i + 1}`);
            });
            await sheet.setHeaderRow(headers);

            await sheet.addRow(voteData);
            res.json({ success: true });
        } catch (error) {
            console.error('Error saving vote to Google Sheets:', error.message);
            res.json({ success: true });
        }
    } else {
        console.log('Google Sheets not initialized, saving vote locally.');
        res.json({ success: true });
    }
});

// API to get voting results
app.get('/api/results', async (req, res) => {
    let votes = localVotes;

    if (isGoogleSheetsInitialized) {
        try {
            const sheet = doc.sheetsByIndex[1];
            const rows = await sheet.getRows();
            votes = rows.map(row => {
                const vote = {
                    phoneNumber: row.get('phoneNumber'),
                    timestamp: row.get('timestamp')
                };
                questions.forEach((_, i) => {
                    vote[`question_${i + 1}`] = row.get(`question_${i + 1}`);
                    vote[`answer_${i + 1}`] = row.get(`answer_${i + 1}`);
                });
                return vote;
            });
        } catch (error) {
            console.error('Error fetching votes from Google Sheets:', error.message);
            console.log('Falling back to local votes.');
        }
    }

    try {
        const results = questions.map((q, i) => {
            const questionKey = `question_${i + 1}`;
            const answerKey = `answer_${i + 1}`;
            const questionVotes = votes.filter(v => v[questionKey] === q.question);
            return {
                question: q.question,
                for: questionVotes.filter(v => v[answerKey] === 'בעד').length,
                against: questionVotes.filter(v => v[answerKey] === 'נגד').length
            };
        });
        res.json(results);
    } catch (error) {
        console.error('Error calculating results:', error.message);
        res.json([]);
    }
});

// API to download results as CSV
app.get('/api/results/csv', async (req, res) => {
    let votes = localVotes;

    if (isGoogleSheetsInitialized) {
        try {
            const sheet = doc.sheetsByIndex[1];
            const rows = await sheet.getRows();
            votes = rows.map(row => {
                const vote = {
                    phoneNumber: row.get('phoneNumber'),
                    timestamp: row.get('timestamp')
                };
                questions.forEach((_, i) => {
                    vote[`question_${i + 1}`] = row.get(`question_${i + 1}`);
                    vote[`answer_${i + 1}`] = row.get(`answer_${i + 1}`);
                });
                return vote;
            });
        } catch (error) {
            console.error('Error fetching votes for CSV:', error.message);
            console.log('Falling back to local votes.');
        }
    }

    try {
        const headers = ['phoneNumber', 'timestamp'];
        questions.forEach((_, i) => {
            headers.push(`question_${i + 1}`, `answer_${i + 1}`);
        });
        const csv = [headers.join(',')];

        votes.forEach(vote => {
            const row = [
                vote.phoneNumber,
                vote.timestamp,
                ...questions.flatMap((_, i) => [
                    vote[`question_${i + 1}`],
                    vote[`answer_${i + 1}`]
                ])
            ];
            csv.push(row.join(','));
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('voting-results.csv');
        res.send(csv.join('\n'));
    } catch (error) {
        console.error('Error generating CSV:', error.message);
        res.status(500).send('Error generating CSV');
    }
});

// Serve login.html as the default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'voting-app', 'login.html'));
});

// Serve other HTML files explicitly
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'voting-app', 'index.html'));
});

app.get('/results.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'voting-app', 'results.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});