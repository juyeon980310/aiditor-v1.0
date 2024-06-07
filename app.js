const express = require('express');
const app = express();
const path = require('path');
const multer = require('multer');
const { S3Client, PutObjectCommand, ListObjectsCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const stream = require('stream');
require('dotenv').config();

// AWS S3 클라이언트 설정
const s3Client = new S3Client({
  region: process.env.REGION_S,
  credentials: {
    accessKeyId: process.env.ID_S,
    secretAccessKey: process.env.SECRET_S,
  }
});

// Multer 설정
const upload = multer({ dest: 'uploads/' });

let NODE_MAIN;

app.use(function (req, res, next) {
  NODE_MAIN = "http://" + req.get("host").replace("8500", "8000");
  next();
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', {NODE_MAIN:NODE_MAIN});
});

app.get('/face', (req, res) => {
  res.render('face', {NODE_MAIN:NODE_MAIN});
});

app.get('/pop_upload', (req, res) => {
  res.render('pop_upload');
});

app.get('/face_con', async (req, res) => {
  const params = {
    Bucket: process.env.BUCKET_NAME_S,
    Prefix: 'rawvideo/',
  };

  try {
    const data = await s3Client.send(new ListObjectsCommand(params));
    if (!data.Contents) {
      throw new Error('No contents in S3 response');
    }
    // 최신 파일을 찾기 위해 data.Contents를 정렬합니다.
    const latestFile = data.Contents
      .filter(item => item.Key.endsWith('.mp4'))
      .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0];

    const videoName = latestFile ? latestFile.Key.replace('rawvideo/', '') : null;
    res.render('face_con', { videoName });
  } catch (err) {
    console.error('Error listing videos:', err);
    res.status(500).json({ message: 'Error listing videos', error: err });
  }
});

app.get('/face_complete', (req, res) => {
  const { videoName } = req.query;
  res.render('face_complete', { videoName , NODE_MAIN:NODE_MAIN});
});

app.get('/download', async (req, res) => {
  const { fileName } = req.query;
  const params = {
    Bucket: process.env.BUCKET_NAME_S,
    Key: `rawvideo/${fileName}`
  };

  try {
    const command = new GetObjectCommand(params);
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    const passThrough = new stream.PassThrough();
    s3Client.send(command).then((data) => {
      data.Body.pipe(passThrough);
    });

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    passThrough.pipe(res);
  } catch (err) {
    console.error('Error getting file from S3:', err);
    res.status(500).json({ message: 'Error getting file from S3', error: err });
  }
});

app.get('/list_videos', async (req, res) => {
  const params = {
    Bucket: process.env.BUCKET_NAME_S,
    Prefix: 'rawvideo/',
  };

  try {
    const data = await s3Client.send(new ListObjectsCommand(params));
    if (!data.Contents) {
      throw new Error('No contents in S3 response');
    }
    const videos = data.Contents.filter(item => item.Key.endsWith('.mp4')).map(item => item.Key.replace('rawvideo/', ''));
    res.json({ videos });
  } catch (err) {
    console.error('Error listing videos:', err);
    res.status(500).json({ message: 'Error listing videos', error: err });
  }
});

app.post('/upload', upload.single('videoFile'), async (req, res) => {
  const fileContent = fs.readFileSync(req.file.path);
  const params = {
    Bucket: process.env.BUCKET_NAME_S,
    Key: `rawvideo/${req.file.originalname}`,
    Body: fileContent,
    ContentType: req.file.mimetype
  };

  try {
    const data = await s3Client.send(new PutObjectCommand(params));
    console.log('File uploaded successfully', data);
    res.json({ data: { Key: params.Key } });
    fs.unlinkSync(req.file.path); // 로컬 파일 삭제
  } catch (err) {
    console.error('Error uploading to S3:', err);
    res.status(500).json({ message: 'Error uploading file', error: err });
  }
});

const PORT = process.env.PORT || 8500;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
