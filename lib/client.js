/**
 * dsh-safe-restart — 浏览器半部（设置页「安全重启」）
 *
 * 手写 ModuleLoader bundle，不需要构建：
 *   window.__ModuleLoader__.load({ id, factory })
 * 数据直接走宿主半部的 HTTP 接口（/safe-restart/*），不依赖 dsh-settings。
 */
window.__ModuleLoader__.load({
  id: 'dsh-safe-restart',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var ROUTE = '/safe-restart'

    var styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0', color: 'inherit' },
      card: { border: '1px solid rgba(128,128,128,0.3)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      hint: { fontSize: '12px', opacity: 0.65, lineHeight: 1.6 },
      dot: function (on) {
        return { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: on ? '#22c55e' : '#9ca3af' }
      },
      btn: { border: '1px solid rgba(128,128,128,0.4)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '13px' },
      pre: { fontSize: '11px', lineHeight: 1.5, background: 'rgba(128,128,128,0.12)', borderRadius: '6px', padding: '8px', margin: 0, maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
      mono: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px' }
    }

    var STATE_TEXT = {
      patched: '补丁已生效',
      clean: '未打补丁',
      unknown: 'main.js 结构与预期不符'
    }

    function useSafeRestart() {
      var state = react.useState(null)
      var data = state[0]
      var setData = state[1]
      var busyState = react.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var errState = react.useState('')
      var error = errState[0]
      var setError = errState[1]

      function load() {
        fetch(ROUTE + '/state', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json() })
          .then(function (j) { setData(j) })
          .catch(function (e) { setError(String((e && e.message) || e)) })
      }

      function post(action) {
        setBusy(true)
        setError('')
        fetch(ROUTE + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ action: action })
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.ok === false) setError(j.error || '操作失败')
            if (j && j.mainPath !== undefined) setData(j)
          })
          .catch(function (e) { setError(String((e && e.message) || e)) })
          .then(function () { setBusy(false) })
      }

      react.useEffect(function () { load() }, [])
      return { data: data, busy: busy, error: error, load: load, post: post }
    }

    function Panel() {
      var s = useSafeRestart()
      var d = s.data
      var stateText = d ? (STATE_TEXT[d.state] || d.state) : '正在读取…'

      return h('div', { style: styles.wrap },
        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h('span', { style: styles.dot(d && d.patched) }),
              h('strong', null, stateText)
            ),
            h('span', { style: styles.hint }, 'v' + (d ? d.version : '?'))
          ),
          h('div', { style: styles.hint },
            '托盘菜单会多一项「重启 DeepSeek Harness」。有任务在跑时先弹原生确认框，' +
            '标题与按钮都是「重启」；判断条件与托盘的「退出 DeepSeek Harness」完全同源。'),
          d && d.needsRestart
            ? h('div', { style: { fontSize: '12px', color: '#f59e0b', lineHeight: 1.6 } },
              'main.js 刚被改过，要重启一次 DSH 才生效（主进程代码已经在内存里了）。')
            : null,
          h('div', { style: styles.hint },
            'main.js：', h('span', { style: styles.mono }, (d && d.mainPath) || '（没找到）')),
          d && d.asar
            ? h('div', { style: { fontSize: '12px', color: '#f59e0b', lineHeight: 1.6 } },
              '检测到 app.asar（', h('span', { style: styles.mono }, d.asar), '）：当前是打包态，需要先解包才能打补丁。')
            : null,
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
            h('button', { style: styles.btn, disabled: s.busy, onClick: function () { s.post('apply') } }, '打补丁'),
            h('button', { style: styles.btn, disabled: s.busy, onClick: function () { s.post('revert') } }, '撤销补丁'),
            h('button', { style: styles.btn, disabled: s.busy, onClick: function () { s.post('recheck') } }, '重新检测'),
            h('button', { style: styles.btn, disabled: s.busy, onClick: s.load }, '刷新')
          ),
          h('div', { style: styles.hint },
            '客户端升级会把 main.js 换掉，本插件每次启动会自动检测并重打；备份文件就在 main.js 旁边（*.bak-dsh-safe-restart）。'),
          h('div', { style: styles.hint },
            '停用或卸载本插件之前，先点一次「撤销补丁」——不然托盘里会留下一个点不动的「重启」项，因为没人接管那次点击了。')
        ),

        s.error ? h('div', { style: { color: '#ef4444', fontSize: '12px', lineHeight: 1.6 } }, s.error) : null,

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('strong', { style: { fontSize: '13px' } }, '最近日志'),
            h('span', { style: styles.hint }, (d && d.dataDir) || '')
          ),
          h('pre', { style: styles.pre }, d && d.log && d.log.length ? d.log.join('\n') : '（暂无）')
        )
      )
    }

    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'safe-restart', order: 28, label: '安全重启' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
