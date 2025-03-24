const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const app = express();
const port = 3000;

// הגדרות ל-Google Sheets (אם אתה משתמש בזה)
const doc = new GoogleSpreadsheet('YOUR_SPREADSHEET_ID');
let creds;
try {
    creds = require('./credentials.json');
} catch (error) {
    console.error('Error loading credentials.json:', error.message);
    creds = null;
}

// מערך זמני של שאלות ברירת מחדל
let questions = [
    { question: 'האם אתה תומך בהצעה להאריך את שעות הפעילות של המרכז הקהילתי?', description: '', active: true },
    { question: 'האם אתה בעד הקמת גינה קהילתית חדשה בשכונה?', description: '', active: true }
];

app.use(express.json());
app.use(express.static('public'));

// טעינת שאלות מ-Google Sheets
async function loadQuestions() {
    if (!creds) {
        console.log('No credentials found, using default questions.');
        return;
    }

    try {
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        questions = rows.map(row => ({
            question: row.question,
            description: row.description || '',
            active: row.active === 'TRUE'
        }));

        // אם אין שאלות ב-Google Sheets, השתמש בשאלות ברירת המחדל
        if (questions.length === 0) {
            console.log('No questions found in Google Sheets, adding default questions.');
            await sheet.addRows(questions);
        }
    } catch (error) {
        console.error('Error loading questions from Google Sheets:', error.message);
        console.log('Falling back to default questions.');
    }
}

// טען שאלות בעת הפעלת השרת
loadQuestions();

// API לקבלת שאלות
app.get('/api/questions', (req, res) => {
    res.json(questions);
});

// API לשמירת שאלות
app.post('/api/questions', async (req, res) => {
    const newQuestion = req.body;
    questions.push(newQuestion);
    try {
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow(newQuestion);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving question:', error.message);
        res.json({ success: true }); // ממשיך לעבוד עם המערך הזמני
    }
});

// API לעדכון שאלות
app.post('/api/questions/update', async (req, res) => {
    questions = req.body;
    try {
        const sheet = doc.sheetsByIndex[0];
        await sheet.clear();
        await sheet.setHeaderRow(['question', 'description', 'active']);
        await sheet.addRows(questions.map(q => ({ ...q, active: q.active.toString() })));
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating questions:', error.message);
        res.json({ success: true }); // ממשיך לעבוד עם המערך הזמני
    }
});

// API לשליחת הצבעה
app.post('/api/vote', async (req, res) => {
    const { phoneNumber, answers } = req.body;
    try {
        const sheet = doc.sheetsByIndex[1]; // גיליון להצבעות
        for (let i = 0; i < answers.length; i++) {
            await sheet.addRow({
                phoneNumber,
                question: questions[i].question,
                answer: answers[i],
                timestamp: new Date().toISOString()
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving vote:', error.message);
        res.json({ success: false });
    }
});

// API לקבלת תוצאות
app.get('/api/results', async (req, res) => {
    try {
        const sheet = doc.sheetsByIndex[1];
        const rows = await sheet.getRows();
        const results = questions.map(q => {
            const votes = rows.filter(row => row.question === q.question);
            return {
                question: q.question,
                for: votes.filter(v => v.answer === 'בעד').length,
                against: votes.filter(v => v.answer === 'נגד').length
            };
        });
        res.json(results);
    } catch (error) {
        console.error('Error fetching results:', error.message);
        res.json([]);
    }
});

// API להורדת תוצאות כ-CSV
app.get('/api/results/csv', async (req, res) => {
    try {
        const sheet = doc.sheetsByIndex[1];
        const rows = await sheet.getRows();
        const csv = ['phoneNumber,question,answer,timestamp'];
        rows.forEach(row => {
            csv.push(`${row.phoneNumber},${row.question},${row.answer},${row.timestamp}`);
        });
        res.header('Content-Type', 'text/csv');
        res.attachment('voting-results.csv');
        res.send(csv.join('\n'));
    } catch (error) {
        console.error('Error generating CSV:', error.message);
        res.status(500).send('Error generating CSV');
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});