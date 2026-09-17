import nodemailer from 'nodemailer';
export function mailer(env=process.env){
 const local=env.SMTP_HOST==='localhost'||env.SMTP_HOST==='127.0.0.1';
 const ready=Boolean(env.SMTP_HOST&&env.MAIL_FROM&&(local||(env.SMTP_USER&&env.SMTP_PASS)));
 const transport=ready?nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||(local?25:465)),secure:local?false:env.SMTP_SECURE!=='false',ignoreTLS:local,auth:local?undefined:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:10000,socketTimeout:15000}):null;
 return {ready,async send(to,subject,text){if(!ready)throw new Error('MAIL_NOT_CONFIGURED');await transport.sendMail({from:env.MAIL_FROM,to,subject,text});}};
}
