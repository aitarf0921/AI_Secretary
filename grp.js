const go = async () => {

  const upperCaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowerCaseChars = 'abcdefghijklmnopqrstuvwxyz';
    const numberChars = '0123456789';

    const allChars = upperCaseChars + lowerCaseChars + numberChars;
    const length = 12;

    let password = '';
    for (let i = 0; i < length; i++) {
      const randomChar = allChars[Math.floor(Math.random() * allChars.length)];
      password += randomChar;
    }

  password = `aitarf_${password}`;

  console.log(password);

  return password;


};
go();
