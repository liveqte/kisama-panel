<?php
// 通知中心公告源：读取同目录 notification.txt，一行一条公告
// 面板前端跨域拉取，必须放行 CORS（与 ipapi/query.php 同样的做法）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-cache');

// 预检请求直接放行
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$file = __DIR__ . '/notification.txt';
if (!is_readable($file)) {
    http_response_code(404);
    echo 'notification.txt not found';
    exit;
}

readfile($file);
