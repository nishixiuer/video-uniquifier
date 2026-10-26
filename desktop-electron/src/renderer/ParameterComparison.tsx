import { useEffect, useState } from "react";
import { Alert, Table, Tag } from "antd";
import type { Job, Json } from "./types";
import { call } from "./store";
import {
  comparisonRows,
  loadComparison,
  type ComparisonData,
} from "./comparison";

export default function ParameterComparison({
  job,
  report,
}: {
  job: Job;
  report?: Json;
}) {
  const [data, setData] = useState<ComparisonData | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    void loadComparison(
      job,
      (method, params) => call<Json>(method, params),
      report,
    ).then((result) => {
      if (active) setData(result);
    });
    return () => {
      active = false;
    };
  }, [job.id, job.source, job.output, report]);
  return (
    <section aria-label="原片与成片参数对比">
      {data?.notices.map((notice) => (
        <Alert
          key={notice}
          type="warning"
          showIcon
          message={notice}
          className="mb-3"
        />
      ))}
      <Table
        loading={!data}
        size="small"
        rowKey="key"
        pagination={false}
        scroll={{ y: 390 }}
        dataSource={data ? comparisonRows(data) : []}
        columns={[
          { title: "参数", dataIndex: "label", width: "23%" },
          { title: "原始视频", dataIndex: "before", width: "29%" },
          { title: "处理成片", dataIndex: "after", width: "29%" },
          {
            title: "变化",
            dataIndex: "change",
            render: (value: string) => (
              <Tag color={value === "已变化" ? "processing" : "default"}>
                {value}
              </Tag>
            ),
          },
        ]}
      />
      <p className="muted mt-3">
        参数来自质量报告或本地视频实测，未测量值不推算。文件更大、码率更高不代表画质更好。
      </p>
    </section>
  );
}
