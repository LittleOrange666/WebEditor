// 範例專案（spec §7）

const ab = [
  { name: '測資 1', input: '1 2\n', expected: '3\n' },
  { name: '測資 2', input: '-5 100\n', expected: '95\n' },
];

const CPP_AB = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    long long a, b;
    cin >> a >> b;
    cout << a + b << '\\n';
    return 0;
}
`;

export const DEFAULT_PROJECT = {
  name: '我的專案',
  files: [{ path: 'main.cpp', content: CPP_AB }],
  tests: { 'main.cpp': { cases: ab } },
};

export const EXAMPLES = [
  {
    id: 'cpp-ab',
    name: 'C++：A+B',
    description: '最小範例，含兩組測資',
    files: [{ path: 'main.cpp', content: CPP_AB }],
    tests: { 'main.cpp': { cases: ab } },
  },
  {
    id: 'cpp-multi',
    name: 'C++：多檔案（自訂標頭檔）',
    description: '示範 #include 專案中的標頭檔',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include "lib/mathutil.h"
using namespace std;

int main() {
    long long a, b;
    cin >> a >> b;
    cout << "gcd = " << mymath::gcd(a, b) << '\\n';
    cout << "lcm = " << mymath::lcm(a, b) << '\\n';
}
`,
      },
      {
        path: 'lib/mathutil.h',
        content: `#pragma once

namespace mymath {
// 標頭檔中直接寫出實作（WebEditor 只編譯目前這一個 .cpp）
inline long long gcd(long long a, long long b) { return b ? gcd(b, a % b) : a; }
inline long long lcm(long long a, long long b) { return a / gcd(a, b) * b; }
}
`,
      },
    ],
    tests: { 'main.cpp': { cases: [{ name: '測資 1', input: '12 18\n', expected: 'gcd = 6\nlcm = 36\n' }] } },
  },
  {
    id: 'py-ab',
    name: 'Python：A+B',
    description: '最小範例，含兩組測資',
    files: [{ path: 'main.py', content: 'a, b = map(int, input().split())\nprint(a + b)\n' }],
    tests: { 'main.py': { cases: ab } },
  },
  {
    id: 'py-multi',
    name: 'Python：多檔案（import）',
    description: '示範 import 同專案的其他 .py',
    files: [
      {
        path: 'main.py',
        content: `from helper import is_prime

n = int(input())
primes = [x for x in range(2, n + 1) if is_prime(x)]
print(len(primes))
print(*primes)
`,
      },
      {
        path: 'helper.py',
        content: `def is_prime(x):
    if x < 2:
        return False
    i = 2
    while i * i <= x:
        if x % i == 0:
            return False
        i += 1
    return True
`,
      },
    ],
    tests: { 'main.py': { cases: [{ name: '測資 1', input: '20\n', expected: '8\n2 3 5 7 11 13 17 19\n' }] } },
  },
  {
    id: 'py-guess',
    name: 'Python：猜數字（終端機模式）',
    description: '互動式程式，請切換到「終端機」模式執行',
    files: [
      {
        path: 'guess.py',
        content: `import random

answer = random.randint(1, 100)
print("我想了一個 1 到 100 的整數，猜猜看！")
tries = 0
while True:
    try:
        g = int(input("你的猜測："))
    except EOFError:
        print("\\n再見！")
        break
    except ValueError:
        print("請輸入整數")
        continue
    tries += 1
    if g < answer:
        print("太小了")
    elif g > answer:
        print("太大了")
    else:
        print(f"答對了！你猜了 {tries} 次")
        break
`,
      },
    ],
    tests: {},
  },
  {
    id: 'cpp-guess',
    name: 'C++：猜數字（終端機模式）',
    description: '互動式程式，請切換到「終端機」模式執行',
    files: [
      {
        path: 'guess.cpp',
        content: `#include <bits/stdc++.h>
using namespace std;

int main() {
    mt19937 rng(random_device{}());
    int answer = rng() % 100 + 1, tries = 0, g;
    cout << "我想了一個 1 到 100 的整數，猜猜看！" << endl;
    while (cout << "你的猜測：" && cin >> g) {
        tries++;
        if (g < answer) cout << "太小了" << endl;
        else if (g > answer) cout << "太大了" << endl;
        else { cout << "答對了！你猜了 " << tries << " 次" << endl; break; }
    }
}
`,
      },
    ],
    tests: {},
  },
  {
    id: 'js-ab',
    name: 'JavaScript：A+B',
    description: '示範 readline() 與 Node.js 風格的讀法',
    files: [
      {
        path: 'main.js',
        content: `// 可用 readline() 逐行讀取，或 require('fs').readFileSync(0, 'utf8') 一次讀完
const [a, b] = readline().split(' ').map(Number);
console.log(a + b);
`,
      },
    ],
    tests: { 'main.js': { cases: ab } },
  },
];
