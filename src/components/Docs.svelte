<script>
  import { IS_CLOUD } from '../lib/config.js';
  // 使用說明（spec §7）
</script>

<article class="docs">
  <h1>WebEditor 使用說明</h1>
  <p>WebEditor 是在瀏覽器中執行的程式編輯器：程式碼存在你的瀏覽器裡（IndexedDB），編譯與執行也都在本機完成，不會上傳到伺服器（使用「分享」功能時除外）。</p>

  <h2>專案與檔案</h2>
  <ul>
    <li>可以有多個專案，從左上角的專案名稱切換、新增、複製、刪除；也可以從「範例」建立範例專案。</li>
    <li>每個專案是一棵檔案樹，可以有子資料夾。檔案上的 <kbd>⋯</kbd> 按鈕（或右鍵）可重新命名、移動、下載、刪除；也可以直接拖曳檔案到資料夾。</li>
    <li>上傳：單一或多個檔案、整個資料夾、zip（可選擇建立新專案或解壓到目前資料夾），也可以把檔案拖到檔案樹上。</li>
    <li>下載：單一檔案、資料夾（zip）、整個專案（zip，包含測資，重新上傳即可還原）。</li>
    <li>編輯內容會自動儲存。</li>
  </ul>

  <h2>多個瀏覽器分頁</h2>
  <ul>
    <li>所有分頁共用同一份資料，在一個分頁修改後，其他分頁會自動更新。</li>
    <li>同一個檔案一次只能在一個分頁編輯；在其他分頁會顯示為唯讀，可以按「在這裡編輯」取得編輯權。</li>
  </ul>

  <h2>執行程式</h2>
  <p>按「▶ 執行」或 <kbd>Ctrl</kbd>+<kbd>Enter</kbd>（Mac 為 <kbd>⌘</kbd>+<kbd>Enter</kbd>）執行<strong>目前分頁</strong>的檔案。依副檔名決定語言：</p>
  <ul>
    <li><strong>C++</strong>（<code>.cpp</code> <code>.cc</code> <code>.cxx</code>）：以 <code>-std=c++20 -O2</code> 編譯，可以 <code>#include "xxx.h"</code> 專案中的標頭檔（先找同資料夾，再找專案根目錄），也可以用 <code>&lt;bits/stdc++.h&gt;</code>。只編譯目前這一個 .cpp。</li>
    <li><strong>Python</strong>（<code>.py</code>）：可以 <code>import</code> 同資料夾的其他 .py。第一次執行時會下載 Python 執行環境。</li>
    <li><strong>JavaScript</strong>（<code>.js</code>）：可用 <code>readline()</code>、<code>readAll()</code>、<code>console.log</code>，也支援 <code>require('fs').readFileSync(0, 'utf8')</code> 與 <code>require('readline')</code> 的常見寫法。</li>
  </ul>

  <h3>測資模式</h3>
  <ul>
    <li>每個程式檔有自己的一組測資（輸入＋預期輸出）。「全部執行」會逐組執行並顯示 AC / WA / TLE / RE 與執行時間。</li>
    <li>預期輸出留空時只執行、不比對。WA 時會標示第一個不同的地方。</li>
    <li>比對方式預設「忽略空白差異」（行尾空白、檔尾空行不影響），也可改為「完全相同」。</li>
    <li>可以批次上傳 <code>1.in</code> / <code>1.out</code> 這類檔案或 zip，自動配對。</li>
  </ul>

  <h3>終端機模式</h3>
  <ul>
    <li>像終端機一樣邊執行邊輸入，適合互動式程式。輸入後按 <kbd>Enter</kbd> 送出、<kbd>Ctrl</kbd>+<kbd>D</kbd> 送出 EOF、<kbd>Ctrl</kbd>+<kbd>C</kbd> 停止。</li>
    <li>沒有時限，需要時按「■ 停止」。stderr 可選擇以紅色合併顯示或分開顯示。</li>
    <li>C++ 若用 <code>printf</code> 印出不換行的提示，可能要等到換行才會顯示，建議用 <code>cout</code> 或加上 <code>fflush(stdout)</code>。</li>
  </ul>

  <h3>C++ 的限制</h3>
  <ul>
    <li>不能使用 C++ 例外（<code>try</code> / <code>throw</code>），<code>std::stoi</code> 等失敗時程式會直接中止。</li>
    <li>遞迴深度約 5,000 層，太深會當掉（評測機上可能正常）。</li>
    <li>32 位元環境：<code>long</code> 只有 4 bytes，請用 <code>long long</code>。</li>
    <li>第一次使用需下載約 18 MB（壓縮後）的編譯器；手機上編譯可能很慢或失敗。</li>
  </ul>
  <p>執行時間僅供參考，與正式評測環境差異很大。</p>

  {#if IS_CLOUD}
  <h2>帳號與雲端同步</h2>
  <ul>
    <li>不登入也能使用所有編輯與執行功能，專案只存在這台裝置。</li>
    <li>登入後，新專案會自動存到雲端；在其他裝置登入同一個帳號就能看到相同的專案。第一次在一台裝置登入時，可以選擇要上傳哪些既有的專案。</li>
    <li><strong>只會同步程式檔</strong>（<code>.cpp</code> <code>.cc</code> <code>.cxx</code> <code>.h</code> <code>.hpp</code> <code>.py</code> <code>.js</code>）、資料夾結構與設定。測資與其他檔案（例如 <code>.txt</code>）只存在這台裝置，檔案樹中會標示 💻。</li>
    <li>超過雲端上限的檔案也只存在這台裝置；縮小後會自動恢復同步。</li>
    <li>離線時照常編輯，修改會先存在瀏覽器，連上網路後自動上傳。</li>
    <li>同一個檔案在兩台裝置都被修改（例如離線編輯）時，雲端的版本會保留在原檔，你的版本另存為「衝突副本」檔案。</li>
    <li>專案清單中可以把專案「改為僅本地」或「上傳到雲端」；帳號設定中可以「下載所有專案」備份。</li>
  </ul>

  <h2>分享</h2>
  <ul>
    <li>登入後按「分享」，可以分享目前的檔案或整個專案（只含程式檔，不含測資）。分享的是當下的快照，之後的修改不會影響分享內容。</li>
    <li>可以設定到期時間（1 天、7 天、30 天或永不過期），並在「我的分享」中隨時撤銷。</li>
    <li>任何拿到連結的人都能開啟唯讀頁面，按「開啟編輯」即可匯入到自己的編輯器（不需要登入）。</li>
    <li>在連結後面加上 <code>/import</code>（<code>…/#/s/&lt;ID&gt;/import</code>）會直接開啟匯入畫面，方便老師提供「一鍵載入」的連結。</li>
  </ul>
  {:else}
  <h2>分享到 APCS Code Noter</h2>
  <ul>
    <li>按「分享」把目前的檔案上傳到 <a href="https://coder.apcs.top/" target="_blank" rel="noopener noreferrer">coder.apcs.top</a>，取得分享連結，並可產生 QR Code。</li>
    <li>按「匯入」貼上分享連結，即可把程式碼載入到目前專案或建立新專案。</li>
    <li>也可以用 <code>…/#/import/&lt;ID&gt;</code> 形式的網址直接開啟匯入畫面。</li>
    <li>需要先在「設定」中填寫代理網址。</li>
  </ul>
  {/if}

  <h2>資料備份</h2>
  <p>瀏覽器可能會清除網站資料（例如清除瀏覽資料、無痕模式關閉、Safari 超過 7 天未開啟）。<strong>重要的專案請下載專案 zip 備份。</strong></p>

  <p><a href="#/">← 回到編輯器</a></p>
</article>

<style>
  .docs { max-width: 820px; margin: 0 auto; padding: 20px 16px 60px; line-height: 1.7; overflow: auto; height: 100%; }
  h1 { font-size: 24px; }
  h2 { font-size: 19px; margin-top: 28px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  h3 { font-size: 16px; margin-top: 18px; }
  code, kbd { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); }
</style>
